import type {
  ClientWerewolfSync,
  DeductionNote,
  UserProfile,
  WerewolfActionState,
  WerewolfActionType,
  WerewolfChatMessage,
  WerewolfFaction,
  WerewolfGameState,
  WerewolfLogEntry,
  WerewolfNightSummary,
  WerewolfPhase,
  WerewolfPlayer,
  WerewolfRole,
} from './src/werewolfTypes';

export const BOT_NAMES = [
  { name: 'Bác Trưởng Thôn', avatar: '👴', color: '#B45309' },
  { name: 'Cô Thợ Gốm', avatar: '👩‍🌾', color: '#059669' },
  { name: 'Chàng Tiều Phu', avatar: '🪓', color: '#D97706' },
  { name: 'Bà Thầy Bói', avatar: '🔮', color: '#7C3AED' },
  { name: 'Bác Sĩ Làng', avatar: '👨‍⚕️', color: '#2563EB' },
  { name: 'Chị Dệt Vải', avatar: '🧶', color: '#DB2777' },
  { name: 'Thợ Rèn Sắt', avatar: '⚒️', color: '#4B5563' },
  { name: 'Người Gác Đêm', avatar: '🏮', color: '#4F46E5' },
];

export class WerewolfRoomGame {
  roomId: string;
  phase: WerewolfPhase = 'lobby';
  round: number = 0;
  players: WerewolfPlayer[] = [];
  timerSeconds: number = 0;
  timerTotal: number = 0;
  actions: WerewolfActionState = {
    witchHasHealPotion: true,
    witchHasPoisonPotion: true,
    dayVotes: {},
  };
  nightPendingVictimId?: string;
  lastNightSummary?: WerewolfNightSummary;
  logs: WerewolfLogEntry[] = [];
  chatMessages: WerewolfChatMessage[] = [];
  winner?: WerewolfFaction;
  hostId: string = '';
  seerHistoryByUser: Record<string, Array<{ targetId: string; targetName: string; isWolf: boolean; round: number }>> = {};
  timerInterval: NodeJS.Timeout | null = null;
  onStateUpdate: (roomId: string) => void;
  onChatMessage: (roomId: string, msg: WerewolfChatMessage) => void;

  constructor(
    roomId: string,
    onStateUpdate: (roomId: string) => void,
    onChatMessage: (roomId: string, msg: WerewolfChatMessage) => void
  ) {
    this.roomId = roomId;
    this.onStateUpdate = onStateUpdate;
    this.onChatMessage = onChatMessage;
  }

  addPlayer(user: UserProfile) {
    if (this.phase !== 'lobby') return;
    if (this.players.some((p) => p.id === user.id)) return;

    if (this.players.length === 0) {
      this.hostId = user.id;
    }

    this.players.push({
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      color: user.color,
      isBot: false,
      isAlive: true,
      votesReceived: 0,
    });

    this.addLog('system', `Thành viên ${user.name} đã ngồi vào bàn Ma Sói.`);
    this.broadcast();
  }

  removePlayer(userId: string) {
    if (this.phase !== 'lobby') return;
    const idx = this.players.findIndex((p) => p.id === userId);
    if (idx > -1) {
      const removed = this.players.splice(idx, 1)[0];
      if (this.hostId === userId && this.players.length > 0) {
        this.hostId = this.players[0].id;
      }
      this.addLog('system', `${removed.name} đã rời khỏi bàn chơi.`);
      this.broadcast();
    }
  }

  addBots(targetCount: number = 6) {
    if (this.phase !== 'lobby') return;
    let botIndex = 0;
    while (this.players.length < targetCount && botIndex < BOT_NAMES.length) {
      const botPreset = BOT_NAMES[botIndex++];
      if (this.players.some((p) => p.name === botPreset.name)) continue;

      this.players.push({
        id: `bot-${Date.now()}-${botIndex}`,
        name: botPreset.name,
        avatar: botPreset.avatar,
        color: botPreset.color,
        isBot: true,
        isAlive: true,
        votesReceived: 0,
      });
    }

    this.addLog('system', `Đã bổ sung người chơi máy (Bot). Tổng số người trong làng: ${this.players.length}.`);
    this.broadcast();
  }

  startGame(userId: string) {
    if (this.phase !== 'lobby') return;
    if (this.players.length < 4) {
      // Auto add bots if not enough players so user can test right away
      this.addBots(6);
    }

    const n = this.players.length;
    // Determine roles composition
    // <= 5 players: 1 wolf, 1 seer, 1 guard, remaining villagers
    // 6-7 players: 2 wolves, 1 seer, 1 guard, 1 witch, remaining villagers
    // 8+ players: 2-3 wolves, 1 seer, 1 guard, 1 witch, 1 hunter, remaining villagers
    let wolfCount = n >= 8 ? 2 : n >= 5 ? 2 : 1;
    const rolesPool: WerewolfRole[] = [];
    for (let i = 0; i < wolfCount; i++) rolesPool.push('werewolf');
    rolesPool.push('seer');
    rolesPool.push('bodyguard');
    if (n >= 6) rolesPool.push('witch');
    if (n >= 7) rolesPool.push('hunter');
    while (rolesPool.length < n) {
      rolesPool.push('villager');
    }

    // Shuffle roles
    for (let i = rolesPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rolesPool[i], rolesPool[j]] = [rolesPool[j], rolesPool[i]];
    }

    this.players.forEach((p, idx) => {
      p.role = rolesPool[idx];
      p.isAlive = true;
      p.deathReason = undefined;
      p.deathRound = undefined;
      p.revealedRole = undefined;
      p.votesReceived = 0;
    });

    this.round = 1;
    this.seerHistoryByUser = {};
    this.actions = {
      witchHasHealPotion: true,
      witchHasPoisonPotion: true,
      dayVotes: {},
    };

    this.addLog('system', '🌕 TRĂNG MÁU LÊN CAO: Ván chơi Ma Sói chính thức bắt đầu! Mọi người hãy lật thẻ nhận vai trò của mình.');
    this.sendNarratorChat('🌕 Đêm đầu tiên đã buông xuống trên ngôi làng... Mọi người hãy nhắm mắt đi ngủ!');

    this.startNightPhase();
  }

  resetGame() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.phase = 'lobby';
    this.round = 0;
    this.winner = undefined;
    this.nightPendingVictimId = undefined;
    this.lastNightSummary = undefined;
    this.players.forEach((p) => {
      p.role = undefined;
      p.revealedRole = undefined;
      p.isAlive = true;
      p.deathReason = undefined;
      p.deathRound = undefined;
      p.votesReceived = 0;
    });
    this.actions = {
      witchHasHealPotion: true,
      witchHasPoisonPotion: true,
      dayVotes: {},
    };
    this.addLog('system', 'Bàn chơi đã được đặt lại về sảnh chờ.');
    this.broadcast();
  }

  startNightPhase() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.phase = 'night';
    this.timerTotal = 35;
    this.timerSeconds = 35;

    // Reset night choices
    this.actions.wolfTargetId = undefined;
    this.actions.seerTargetId = undefined;
    this.actions.seerResult = undefined;
    this.actions.guardTargetId = undefined;
    this.actions.witchSaved = undefined;
    this.actions.witchPoisonTargetId = undefined;
    this.actions.dayVotes = {};
    this.nightPendingVictimId = undefined;

    this.addLog('system', `🌙 ĐÊM THỨ ${this.round}: Các thế lực bóng đêm thức dậy làm nhiệm vụ bí mật.`);
    this.sendNarratorChat(`🌙 Đêm thứ ${this.round}: Màn sương đêm bao phủ ngôi làng. Tiên Tri, Sói, Bảo Vệ và Phù Thủy lần lượt hành động...`);

    // Schedule bots actions
    this.scheduleNightBotActions();

    this.timerInterval = setInterval(() => {
      this.timerSeconds--;
      if (this.timerSeconds <= 0) {
        this.resolveNightPhase();
      } else {
        this.broadcast();
      }
    }, 1000);

    this.broadcast();
  }

  scheduleNightBotActions() {
    const livingBots = this.players.filter((p) => p.isBot && p.isAlive);
    const livingTargets = this.players.filter((p) => p.isAlive);
    const nonWolfTargets = livingTargets.filter((p) => p.role !== 'werewolf');

    // Bot Wolves
    const botWolves = livingBots.filter((p) => p.role === 'werewolf');
    if (botWolves.length > 0 && !this.actions.wolfTargetId) {
      setTimeout(() => {
        if (this.phase === 'night' && !this.actions.wolfTargetId && nonWolfTargets.length > 0) {
          const target = nonWolfTargets[Math.floor(Math.random() * nonWolfTargets.length)];
          this.actions.wolfTargetId = target.id;
          this.nightPendingVictimId = target.id;
          this.broadcast();
        }
      }, 3500);
    }

    // Bot Seer
    const botSeer = livingBots.find((p) => p.role === 'seer');
    if (botSeer) {
      setTimeout(() => {
        if (this.phase === 'night' && !this.actions.seerTargetId) {
          const others = livingTargets.filter((p) => p.id !== botSeer.id);
          if (others.length > 0) {
            const target = others[Math.floor(Math.random() * others.length)];
            this.actions.seerTargetId = target.id;
          }
        }
      }, 5000);
    }

    // Bot Guard
    const botGuard = livingBots.find((p) => p.role === 'bodyguard');
    if (botGuard) {
      setTimeout(() => {
        if (this.phase === 'night' && !this.actions.guardTargetId) {
          const eligible = livingTargets.filter((p) => p.id !== this.actions.lastGuardedId);
          if (eligible.length > 0) {
            const target = eligible[Math.floor(Math.random() * eligible.length)];
            this.actions.guardTargetId = target.id;
          }
        }
      }, 7000);
    }
  }

  handleAction(
    userId: string,
    action: WerewolfActionType,
    targetId?: string
  ) {
    const player = this.players.find((p) => p.id === userId);
    if (!player || !player.isAlive) return;

    // Normalize action aliases
    const normAction =
      action === 'seer_inspect'
        ? 'seer_check'
        : action === 'witch_heal'
        ? 'witch_save'
        : action === 'hunter_shot'
        ? 'hunter_shoot'
        : action === 'vote_lynch'
        ? 'day_vote'
        : action;

    if (this.phase === 'night') {
      if (normAction === 'wolf_kill' && player.role === 'werewolf' && targetId) {
        const victim = this.players.find((p) => p.id === targetId && p.isAlive);
        if (victim && victim.role !== 'werewolf') {
          this.actions.wolfTargetId = victim.id;
          this.nightPendingVictimId = victim.id;
          this.addLog('kill', `Bầy Sói đã nhắm mục tiêu vào ${victim.name}.`, true);
          this.broadcast();
        }
      } else if (normAction === 'seer_check' && player.role === 'seer' && targetId) {
        const target = this.players.find((p) => p.id === targetId && p.isAlive);
        if (target && target.id !== player.id) {
          const isWolf = target.role === 'werewolf';
          this.actions.seerTargetId = target.id;
          this.actions.seerResult = {
            targetId: target.id,
            targetName: target.name,
            isWolf,
            role: target.role || 'villager',
          };

          if (!this.seerHistoryByUser[player.id]) {
            this.seerHistoryByUser[player.id] = [];
          }
          this.seerHistoryByUser[player.id].push({
            targetId: target.id,
            targetName: target.name,
            isWolf,
            round: this.round,
          });

          this.broadcast();
        }
      } else if (normAction === 'guard_protect' && player.role === 'bodyguard' && targetId) {
        if (targetId !== this.actions.lastGuardedId) {
          this.actions.guardTargetId = targetId;
          this.broadcast();
        }
      } else if (normAction === 'witch_save' && player.role === 'witch') {
        if (this.actions.witchHasHealPotion && this.nightPendingVictimId) {
          this.actions.witchSaved = true;
          this.actions.witchHasHealPotion = false;
          this.broadcast();
        }
      } else if (normAction === 'witch_poison' && player.role === 'witch' && targetId) {
        if (this.actions.witchHasPoisonPotion) {
          const target = this.players.find((p) => p.id === targetId && p.isAlive);
          if (target) {
            this.actions.witchPoisonTargetId = target.id;
            this.actions.witchHasPoisonPotion = false;
            this.broadcast();
          }
        }
      }
    } else if (this.phase === 'day_vote') {
      if (normAction === 'day_vote' && targetId) {
        if (targetId === 'skip') {
          delete this.actions.dayVotes[player.id];
        } else {
          const target = this.players.find((p) => p.id === targetId && p.isAlive);
          if (target) {
            this.actions.dayVotes[player.id] = target.id;
          }
        }
        this.updateVoteCounts();
        this.broadcast();
      }
    } else if (this.phase === 'hunter_revenge') {
      if (normAction === 'hunter_shoot' && player.role === 'hunter' && targetId) {
        this.executeHunterRevenge(targetId);
      }
    }
  }

  resolveNightPhase() {
    if (this.timerInterval) clearInterval(this.timerInterval);

    // If wolves haven't targeted, auto-pick random non-wolf
    if (!this.actions.wolfTargetId) {
      const nonWolves = this.players.filter((p) => p.isAlive && p.role !== 'werewolf');
      if (nonWolves.length > 0) {
        const rand = nonWolves[Math.floor(Math.random() * nonWolves.length)];
        this.actions.wolfTargetId = rand.id;
      }
    }

    const deaths: Array<{ id: string; name: string; reason: 'werewolf' | 'witch_poison' }> = [];

    // Check wolf victim
    const wolfTarget = this.players.find((p) => p.id === this.actions.wolfTargetId && p.isAlive);
    let savedByGuard = false;
    let savedByWitch = false;

    if (wolfTarget) {
      if (this.actions.guardTargetId === wolfTarget.id) {
        savedByGuard = true;
      }
      if (this.actions.witchSaved) {
        savedByWitch = true;
      }

      if (!savedByGuard && !savedByWitch) {
        wolfTarget.isAlive = false;
        wolfTarget.deathReason = 'werewolf';
        wolfTarget.deathRound = this.round;
        wolfTarget.revealedRole = wolfTarget.role;
        deaths.push({ id: wolfTarget.id, name: wolfTarget.name, reason: 'werewolf' });
      }
    }

    // Check witch poison
    if (this.actions.witchPoisonTargetId) {
      const poisonTarget = this.players.find((p) => p.id === this.actions.witchPoisonTargetId && p.isAlive);
      if (poisonTarget) {
        poisonTarget.isAlive = false;
        poisonTarget.deathReason = 'witch_poison';
        poisonTarget.deathRound = this.round;
        poisonTarget.revealedRole = poisonTarget.role;
        deaths.push({ id: poisonTarget.id, name: poisonTarget.name, reason: 'witch_poison' });
      }
    }

    this.actions.lastGuardedId = this.actions.guardTargetId;

    this.lastNightSummary = {
      round: this.round,
      killedByWolf: this.actions.wolfTargetId,
      savedByGuard,
      savedByWitch,
      poisonedByWitch: this.actions.witchPoisonTargetId,
      finalDeaths: deaths,
    };

    // Check if Hunter died this night
    const hunterDied = deaths.find((d) => {
      const p = this.players.find((pl) => pl.id === d.id);
      return p?.role === 'hunter';
    });

    if (hunterDied) {
      const hunterPlayer = this.players.find((p) => p.id === hunterDied.id)!;
      if (hunterPlayer.isBot) {
        // Bot hunter shoots random living player
        const targets = this.players.filter((p) => p.isAlive && p.id !== hunterPlayer.id);
        if (targets.length > 0) {
          const randTarget = targets[Math.floor(Math.random() * targets.length)];
          randTarget.isAlive = false;
          randTarget.deathReason = 'hunter_shot';
          randTarget.deathRound = this.round;
          randTarget.revealedRole = randTarget.role;
          deaths.push({ id: randTarget.id, name: randTarget.name, reason: 'werewolf' });
          this.addLog('hunter', `🏹 Thợ Săn ${hunterPlayer.name} trước khi chết đã nổ súng bắn hạ ${randTarget.name}!`);
        }
      } else {
        // Human hunter can shoot
        this.phase = 'hunter_revenge';
        this.timerTotal = 20;
        this.timerSeconds = 20;
        this.addLog('hunter', `🏹 Thợ Săn ${hunterPlayer.name} đã ngã xuống và đang ngắm bắn phát đạn báo thù cuối cùng!`);
        this.broadcast();

        this.timerInterval = setInterval(() => {
          this.timerSeconds--;
          if (this.timerSeconds <= 0) {
            this.proceedToDayPhase(deaths);
          } else {
            this.broadcast();
          }
        }, 1000);
        return;
      }
    }

    this.proceedToDayPhase(deaths);
  }

  executeHunterRevenge(targetId: string) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    const target = this.players.find((p) => p.id === targetId && p.isAlive);
    if (target) {
      target.isAlive = false;
      target.deathReason = 'hunter_shot';
      target.deathRound = this.round;
      target.revealedRole = target.role;
      this.addLog('hunter', `🏹 Thợ Săn nổ súng chính xác kéo theo ${target.name} xuống mồ!`);
      this.sendNarratorChat(`Tiếng súng vang dội xé toạc không gian! ${target.name} đã trúng đạn và tử trận.`);
    }

    this.proceedToDayPhase(this.lastNightSummary?.finalDeaths || []);
  }

  proceedToDayPhase(nightDeaths: Array<{ id: string; name: string; reason: string }>) {
    if (this.timerInterval) clearInterval(this.timerInterval);

    // Announce morning summary
    if (nightDeaths.length === 0) {
      this.addLog('system', `☀️ BÌNH MINH NGÀY ${this.round}: Một đêm bình an vô sự! Không có ai bị hạ sát.`);
      this.sendNarratorChat(`☀️ Mặt trời ló rạng ngày thứ ${this.round}: Tiếng chuông làng gióng lên, đêm qua mọi người đã bình an vô sự!`);
    } else {
      const names = nightDeaths.map((d) => d.name).join(', ');
      this.addLog('kill', `☀️ BÌNH MINH NGÀY ${this.round}: Tin dữ đã đến với làng. Người ngã xuống đêm qua: ${names}.`);
      this.sendNarratorChat(`☀️ Mặt trời lên trong u ám... Đêm qua làng đã mất đi: ${names}. Hãy tìm ra kẻ sát nhân ẩn nấp giữa chúng ta!`);
    }

    if (this.checkWinConditions()) return;

    // Start Day Discussion Phase
    this.phase = 'day_discuss';
    this.timerTotal = 45;
    this.timerSeconds = 45;

    this.timerInterval = setInterval(() => {
      this.timerSeconds--;
      if (this.timerSeconds <= 0) {
        this.startDayVotePhase();
      } else {
        this.broadcast();
      }
    }, 1000);

    this.broadcast();
  }

  startDayVotePhase() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.phase = 'day_vote';
    this.timerTotal = 35;
    this.timerSeconds = 35;
    this.actions.dayVotes = {};
    this.updateVoteCounts();

    this.addLog('lynch', `⚖️ PHIÊN TÒA LÀNG BẮT ĐẦU: Toàn bộ dân làng hãy bỏ phiếu chọn kẻ khả nghi nhất để treo cổ!`);
    this.sendNarratorChat(`⚖️ Đã đến giờ biểu quyết! Hãy nhấp chọn người bạn nghi ngờ là Ma Sói để bỏ phiếu treo cổ.`);

    // Bots vote after a delay
    this.scheduleBotVotes();

    this.timerInterval = setInterval(() => {
      this.timerSeconds--;
      if (this.timerSeconds <= 0) {
        this.resolveDayVotePhase();
      } else {
        this.broadcast();
      }
    }, 1000);

    this.broadcast();
  }

  scheduleBotVotes() {
    const livingBots = this.players.filter((p) => p.isBot && p.isAlive);
    const livingTargets = this.players.filter((p) => p.isAlive);

    livingBots.forEach((bot, index) => {
      setTimeout(() => {
        if (this.phase === 'day_vote') {
          const validTargets = livingTargets.filter((t) => t.id !== bot.id);
          if (validTargets.length > 0) {
            // Slight bias towards previously accused players or random
            const chosen = validTargets[Math.floor(Math.random() * validTargets.length)];
            this.actions.dayVotes[bot.id] = chosen.id;
            this.updateVoteCounts();
            this.broadcast();
          }
        }
      }, 3000 + index * 2000);
    });
  }

  updateVoteCounts() {
    this.players.forEach((p) => {
      p.votesReceived = 0;
    });

    for (const votedTargetId of Object.values(this.actions.dayVotes)) {
      const p = this.players.find((pl) => pl.id === votedTargetId);
      if (p) {
        p.votesReceived++;
      }
    }
  }

  resolveDayVotePhase() {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.updateVoteCounts();
    const living = this.players.filter((p) => p.isAlive);

    // Find player with highest votes
    let maxVotes = 0;
    let candidates: WerewolfPlayer[] = [];

    for (const p of living) {
      if (p.votesReceived > maxVotes) {
        maxVotes = p.votesReceived;
        candidates = [p];
      } else if (p.votesReceived === maxVotes && maxVotes > 0) {
        candidates.push(p);
      }
    }

    if (maxVotes >= 2 && candidates.length === 1) {
      const lynched = candidates[0];
      lynched.isAlive = false;
      lynched.deathReason = 'lynch';
      lynched.deathRound = this.round;
      lynched.revealedRole = lynched.role;

      this.addLog(
        'lynch',
        `⚖️ LÀNG TREO CỔ: ${lynched.name} đã nhận nhiều phiếu nhất (${maxVotes} phiếu) và bị đưa lên giàn treo cổ! Danh tính: ${this.getRoleNameVi(lynched.role)}.`
      );
      this.sendNarratorChat(
        `⚖️ Sau phiên tòa căng thẳng, ${lynched.name} đã bị đưa lên đoạn đầu đài! Sự thật hé lộ: ${lynched.name} là ${this.getRoleNameVi(lynched.role)}.`
      );

      // Check if Hunter was lynched
      if (lynched.role === 'hunter') {
        if (lynched.isBot) {
          const remaining = this.players.filter((p) => p.isAlive);
          if (remaining.length > 0) {
            const shot = remaining[Math.floor(Math.random() * remaining.length)];
            shot.isAlive = false;
            shot.deathReason = 'hunter_shot';
            shot.deathRound = this.round;
            shot.revealedRole = shot.role;
            this.addLog('hunter', `🏹 Thợ Săn ${lynched.name} trước khi chết đã nổ súng bắn hạ ${shot.name}!`);
          }
        } else {
          this.phase = 'hunter_revenge';
          this.timerTotal = 20;
          this.timerSeconds = 20;
          this.broadcast();

          this.timerInterval = setInterval(() => {
            this.timerSeconds--;
            if (this.timerSeconds <= 0) {
              this.afterLynchCheck();
            } else {
              this.broadcast();
            }
          }, 1000);
          return;
        }
      }
    } else {
      this.addLog('lynch', `⚖️ LÀNG BẤT ĐỒNG: Số phiếu hòa hoặc không đủ đa số. Không có ai bị treo cổ hôm nay.`);
      this.sendNarratorChat(`⚖️ Không có ai nhận được đủ đa số phiếu thống nhất. Ngôi làng quyết định tha bổng cho ngày hôm nay!`);
    }

    this.afterLynchCheck();
  }

  afterLynchCheck() {
    if (this.checkWinConditions()) return;

    // Advance to next night
    this.round++;
    this.startNightPhase();
  }

  checkWinConditions(): boolean {
    const living = this.players.filter((p) => p.isAlive);
    const livingWolves = living.filter((p) => p.role === 'werewolf').length;
    const livingVillagers = living.filter((p) => p.role !== 'werewolf').length;

    if (livingWolves === 0) {
      this.phase = 'game_over';
      this.winner = 'village';
      if (this.timerInterval) clearInterval(this.timerInterval);
      this.addLog('system', `🏆 CHIẾN THẮNG: Phe DÂN LÀNG đã tiêu diệt toàn bộ bầy Ma Sói và bảo vệ được sự bình yên!`);
      this.sendNarratorChat(`🏆 Hoan hô! Dân Làng đã quét sạch toàn bộ Ma Sói! Chiến thắng thuộc về sự đoàn kết và trí tuệ của phe Dân Làng!`);
      this.broadcast();
      return true;
    }

    if (livingWolves >= livingVillagers) {
      this.phase = 'game_over';
      this.winner = 'werewolf';
      if (this.timerInterval) clearInterval(this.timerInterval);
      this.addLog('system', `🐺 CHIẾN THẮNG: Phe MA SÓI đã áp đảo ngôi làng! Bóng tối nuốt chửng tất cả.`);
      this.sendNarratorChat(`🐺 Tiếng sói tru vang trời! Bầy Sói đã áp đảo hoàn toàn dân làng. Phe Ma Sói giành chiến thắng chung cuộc!`);
      this.broadcast();
      return true;
    }

    return false;
  }

  addLog(
    type: WerewolfLogEntry['type'],
    content: string,
    isSecretWolf?: boolean,
    isSecretGhost?: boolean
  ) {
    const entry: WerewolfLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      round: this.round,
      phase: this.phase,
      timestamp: Date.now(),
      type,
      content,
      isSecretWolf,
      isSecretGhost,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 100) this.logs.pop();
  }

  sendChatMessage(
    user: UserProfile,
    content: string,
    channel: 'village' | 'wolf' | 'ghost'
  ) {
    const player = this.players.find((p) => p.id === user.id);
    if (!player) return;

    // Restrict channels
    if (channel === 'wolf' && player.role !== 'werewolf') return;
    if (channel === 'ghost' && player.isAlive) return;

    const chatMsg: WerewolfChatMessage = {
      id: `wchat-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      senderId: user.id,
      senderName: user.name,
      senderAvatar: user.avatar,
      senderColor: user.color,
      channel,
      content: content.trim(),
      timestamp: Date.now(),
    };

    this.chatMessages.push(chatMsg);
    if (this.chatMessages.length > 200) this.chatMessages.shift();

    this.onChatMessage(this.roomId, chatMsg);
  }

  sendNarratorChat(content: string) {
    const narratorMsg: WerewolfChatMessage = {
      id: `wchat-narrator-${Date.now()}`,
      senderId: 'sys-narrator',
      senderName: 'Quản Trò Làng',
      senderAvatar: '📜',
      senderColor: '#6366F1',
      channel: 'narrator',
      content,
      timestamp: Date.now(),
    };
    this.chatMessages.push(narratorMsg);
    this.onChatMessage(this.roomId, narratorMsg);
  }

  nextPhase() {
    if (this.phase === 'night') {
      this.resolveNightPhase();
    } else if (this.phase === 'day_discuss') {
      this.startDayVotePhase();
    } else if (this.phase === 'day_vote') {
      this.resolveDayVotePhase();
    }
  }

  getRoleNameVi(role?: WerewolfRole): string {
    switch (role) {
      case 'werewolf':
        return 'Ma Sói 🐺';
      case 'seer':
        return 'Tiên Tri 🔮';
      case 'bodyguard':
        return 'Bảo Vệ 🛡️';
      case 'witch':
        return 'Phù Thủy 🧙‍♀️';
      case 'hunter':
        return 'Thợ Săn 🏹';
      case 'villager':
      default:
        return 'Dân Làng 👨‍🌾';
    }
  }

  // Create fog-of-war filtered state for a specific client
  getClientSync(userId?: string): ClientWerewolfSync {
    const me = this.players.find((p) => p.id === userId);
    const isGameOver = this.phase === 'game_over';
    const isMeDead = me && !me.isAlive;
    const isMeWolf = me && me.role === 'werewolf';

    const safePlayers = this.players.map((p) => {
      // Determine if role can be shown
      let showRole = false;
      if (isGameOver) {
        showRole = true;
      } else if (p.id === userId) {
        showRole = true;
      } else if (isMeWolf && p.role === 'werewolf') {
        showRole = true;
      } else if (!p.isAlive && p.revealedRole) {
        showRole = true;
      }

      return {
        ...p,
        role: showRole ? p.role : undefined,
      };
    });

    const safeLogs = this.logs.filter((log) => {
      if (log.isSecretWolf && !isMeWolf && !isGameOver) return false;
      if (log.isSecretGhost && !isMeDead && !isGameOver) return false;
      return true;
    });

    const safeGameState: WerewolfGameState = {
      roomId: this.roomId,
      phase: this.phase,
      round: this.round,
      players: safePlayers,
      timerSeconds: this.timerSeconds,
      timerTotal: this.timerTotal,
      actions: {
        ...this.actions,
        wolfTargetId: isMeWolf || isGameOver ? this.actions.wolfTargetId : undefined,
        seerTargetId: me?.role === 'seer' || isGameOver ? this.actions.seerTargetId : undefined,
        seerResult: me?.role === 'seer' || isGameOver ? this.actions.seerResult : undefined,
        guardTargetId: me?.role === 'bodyguard' || isGameOver ? this.actions.guardTargetId : undefined,
        witchPoisonTargetId: me?.role === 'witch' || isGameOver ? this.actions.witchPoisonTargetId : undefined,
      },
      nightPendingVictimId: me?.role === 'witch' || isMeWolf || isGameOver ? this.nightPendingVictimId : undefined,
      lastNightSummary: this.lastNightSummary,
      logs: safeLogs,
      winner: this.winner,
      hostId: this.hostId,
    };

    const alliedWolves = isMeWolf
      ? this.players.filter((p) => p.role === 'werewolf').map((p) => p.id)
      : undefined;

    const isSeated = !!me;
    const isHost = this.hostId === userId;
    const nightSubPhase =
      me?.role === 'werewolf'
        ? 'werewolf'
        : me?.role === 'seer'
        ? 'seer'
        : me?.role === 'bodyguard'
        ? 'bodyguard'
        : me?.role === 'witch'
        ? 'witch'
        : 'all';

    const nightPending =
      (me?.role === 'witch' || isMeWolf || isGameOver) && this.nightPendingVictimId
        ? {
            victimId: this.nightPendingVictimId,
            victimName: this.players.find((p) => p.id === this.nightPendingVictimId)?.name,
          }
        : undefined;

    const witchPotions =
      me?.role === 'witch'
        ? {
            hasHeal: this.actions.witchHasHealPotion,
            hasPoison: this.actions.witchHasPoisonPotion,
          }
        : undefined;

    const wolfVotes = isMeWolf && this.actions.wolfTargetId ? { wolf: this.actions.wolfTargetId } : undefined;

    return {
      phase: this.phase,
      nightSubPhase,
      round: this.round,
      players: safePlayers,
      timerSeconds: this.timerSeconds,
      timerTotal: this.timerTotal,
      myRole: me?.role,
      myFaction: me?.role === 'werewolf' ? 'werewolf' : me?.role ? 'village' : undefined,
      isSeated,
      isHost,
      winner: this.winner,
      seerHistory: userId && this.seerHistoryByUser[userId] ? this.seerHistoryByUser[userId] : [],
      logs: safeLogs,
      wolfVotes,
      dayVotes: this.actions.dayVotes,
      nightPending,
      witchPotions,
      alliedWolves,
      gameState: safeGameState,
    };
  }

  broadcast() {
    this.onStateUpdate(this.roomId);
  }
}
