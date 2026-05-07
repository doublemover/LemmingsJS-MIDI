import {
  SkillTypes
} from './ProcgenControllerShared.js';
import {
  PROCGEN_CHALLENGE_TYPES,
  PROCGEN_FALLBACK_DECISIONS,
  createProcgenChallengeCertificate,
  decideProcgenFallback,
  verifyProcgenChallengeCertificateSync
} from '../../solver/ProcgenCertificates.js';
const procgenTerrainDirectorMethods = {
  getGroundExtentX() {
    return Math.max(1, Math.floor(this._groundEndX || 0));
  },

  _getRightmostX() {
    const frontier = this._getFrontierSummary?.();
    if (Number.isFinite(frontier?.x)) return frontier.x;
    if (Number.isFinite(frontier?.rightmostX)) return frontier.rightmostX;
    const entrance = this.level?.entrances?.[0] || null;
    return Number.isFinite(entrance?.x) ? entrance.x : null;
  },

  _scheduleBuilderBurst(originX) {
    const timer = this.game?.getGameTimer?.();
    const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
    this._builderBurst = {
      remaining: this._randInt(1, 5),
      nextDelay: this._randInt(10, 20),
      dueTick: 0,
      originX: Number.isFinite(originX) ? originX : null,
      edgeX: Number.isFinite(originX) ? originX : null,
      edgeAction: null,
      used: new Set()
    };
    this._builderBurst.dueTick = tick + this._builderBurst.nextDelay;
  },

  _scheduleEdgeResponse(edgeX, edgeAction) {
    const timer = this.game?.getGameTimer?.();
    const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
    this._builderBurst = {
      remaining: 1,
      nextDelay: this._randInt(6, 14),
      dueTick: tick + this._randInt(6, 14),
      originX: Number.isFinite(edgeX) ? edgeX : null,
      edgeX: Number.isFinite(edgeX) ? edgeX : null,
      edgeAction: edgeAction || 'blocker',
      used: new Set()
    };
  },

  _processBuilderBurst() {
    const burst = this._builderBurst;
    if (!burst || burst.remaining <= 0) return;
    const timer = this.game?.getGameTimer?.();
    const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
    if (burst.dueTick > tick) return;
    if (burst.edgeAction) {
      const handled = this._applyEdgeResponse(burst, tick);
      burst.remaining -= handled ? 1 : 0;
      if (burst.remaining <= 0) {
        this._builderBurst = null;
      } else {
        burst.dueTick = tick + burst.nextDelay;
      }
      return;
    }
    const applied = this._applyBuilderToNextLemming(burst);
    if (applied) {
      burst.remaining -= 1;
      if (burst.remaining <= 0) {
        this._builderBurst = null;
        return;
      }
      burst.nextDelay = Math.round(burst.nextDelay * 2) + this._randInt(1, 5);
    }
    burst.dueTick = tick + burst.nextDelay;
  },

  _applyEdgeResponse(burst, tick) {
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
    if (!lems.length || !Number.isFinite(burst.edgeX)) return false;
    const edgeX = burst.edgeX + (burst.edgeAction === 'blocker' ? 2 : 0);
    let best = null;
    let bestDist = Infinity;
    for (const lem of lems) {
      if (!lem || lem.removed || lem.disabled) continue;
      if (!this._isAssignableAction(lem)) continue;
      if (burst.edgeAction === 'builder-left' && lem.lookRight) continue;
      if (burst.edgeAction === 'blocker' && lem.lookRight) continue;
      const dist = Math.abs((lem.x ?? 0) - edgeX);
      if (dist < bestDist) {
        bestDist = dist;
        best = lem;
      }
    }
    if (!best) return false;
    const skill = burst.edgeAction === 'builder-left' ? SkillTypes.BUILDER : SkillTypes.BLOCKER;
    const key = burst.edgeAction === 'builder-left' ? 'builder' : 'blocker';
    if (!this._canSpend(key)) return false;
    if (manager.doLemmingAction(best, skill)) {
      this._noteAiAction(best, tick, burst.edgeAction === 'builder-left' ? 48 : 32, {
        action: key,
        reason: burst.edgeAction,
        skillType: skill,
        spent: true,
        targetX: burst.edgeX
      });
      return true;
    }
    this._refundBudget(key);
    return false;
  },

  _processGapBridges() {
    if (!this._gaps.length) return;
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
    let leadX = null;
    if (lems.length) {
      const frontier = this._getFrontierLemming();
      leadX = Number.isFinite(frontier?.x) ? frontier.x : null;
      this._advanceGapScanCursor(leadX);
      const maxTriggerX = Number.isFinite(leadX) ? leadX + this.gapTriggerDistance : Infinity;
      for (let i = this._gapScanStart; i < this._gaps.length; i += 1) {
        const gap = this._gaps[i];
        if (!gap || gap.assigned) continue;
        if (!Number.isFinite(gap.x) || !Number.isFinite(gap.width)) continue;
        if (gap.x > maxTriggerX) break;
        const triggerX = gap.x - this.gapTriggerDistance;
        if (Number.isFinite(leadX) && leadX < triggerX) continue;
        let best = null;
        let bestDist = Infinity;
        for (const lem of lems) {
          if (!lem || lem.removed || lem.disabled || !lem.lookRight) continue;
          if (!this._isAssignableAction(lem)) continue;
          const dist = Math.abs((lem.x ?? 0) - gap.x);
          if (dist < bestDist) {
            bestDist = dist;
            best = lem;
          }
        }
        if (!best) continue;
        if (Number.isFinite(leadX) && best.x < leadX - 8) continue;
        if (manager.doLemmingAction(best, SkillTypes.BUILDER)) {
          const timer = this.game?.getGameTimer?.();
          const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
          this._noteAiAction(best, tick, 48, {
            action: 'builder',
            reason: 'small-gap',
            skillType: SkillTypes.BUILDER,
            spent: true,
            targetX: gap.x
          });
          gap.assigned = true;
        }
      }
    }
    this._pruneGapQueue(leadX);
  },

  _processMidairBuilder() {
    const pending = this._pendingMidairBuilder;
    if (!pending) return;
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
    if (!lems.length) return;
    const timer = this.game?.getGameTimer?.();
    const tick = timer?.getGameTicks?.() ?? timer?.tickIndex ?? 0;
    const ground = this.level?.groundMask;
    const levelHeight = this.level?.height ?? 0;
    const maxDrop = Math.min(this.maxDrop, levelHeight);
    let target = null;

    if (Number.isFinite(pending.targetId)) {
      target = manager?.getLemming?.(pending.targetId) || null;
      const actionName = target?.action?.getActionName?.() || '';
      if (!target || target.removed || target.disabled || actionName !== 'falling') {
        pending.targetId = null;
        pending.dueTick = null;
        target = null;
      }
    }

    if (!target) {
      for (const lem of lems) {
        if (!lem || lem.removed || lem.disabled) continue;
        const actionName = lem.action?.getActionName?.() || '';
        if (actionName !== 'falling') continue;
        pending.targetId = lem.id;
        pending.dueTick = tick + pending.delay;
        target = lem;
        break;
      }
    }

    if (!target || !Number.isFinite(pending.dueTick)) return;
    if (tick < pending.dueTick) return;
    if (!this._canSpend('builder')) return;

    const drop = ground && Number.isFinite(target.x) && Number.isFinite(target.y)
      ? this._getDropAt(ground, Math.floor(target.x), Math.floor(target.y), maxDrop)
      : null;
    if (drop != null && drop <= 1) {
      this._refundBudget('builder');
      return;
    }

    if (manager.doLemmingAction(target, SkillTypes.BUILDER)) {
      this._noteAiAction(target, tick, 48, {
        action: 'builder',
        reason: 'midair-safe-drop',
        skillType: SkillTypes.BUILDER,
        spent: true
      });
      this._pendingMidairBuilder = null;
      return;
    }
    this._refundBudget('builder');
  },

  _applyBuilderToNextLemming(burst) {
    const manager = this.game?.getLemmingManager?.();
    const lems = manager?.lemmings || [];
    if (!lems.length) return false;
    if (Number.isFinite(burst?.edgeX)) {
      let best = null;
      let bestDist = Infinity;
      for (const lem of lems) {
        if (!lem || lem.removed || lem.disabled || !lem.lookRight) continue;
        if (!this._isAssignableAction(lem)) continue;
        if (burst.used?.has?.(lem.id)) continue;
        if (lem.x > burst.edgeX + 8) continue;
        const dist = Math.abs((lem.x ?? 0) - burst.edgeX);
        if (dist < bestDist) {
          bestDist = dist;
          best = lem;
        }
      }
      if (best && manager.doLemmingAction(best, SkillTypes.BUILDER)) {
        const tick = this.game?.getGameTimer?.().tickIndex ?? 0;
        this._noteAiAction(best, tick, 48, {
          action: 'builder',
          reason: 'edge-burst',
          skillType: SkillTypes.BUILDER,
          spent: true,
          targetX: burst.edgeX
        });
        burst.used?.add?.(best.id);
        return true;
      }
    }
    if (Number.isFinite(burst?.originX)) {
      let best = null;
      let bestDist = Infinity;
      for (const lem of lems) {
        if (!lem || lem.removed || lem.disabled || !lem.lookRight) continue;
        if (!this._isAssignableAction(lem)) continue;
        if (burst.used?.has?.(lem.id)) continue;
        const dist = Math.abs((lem.x ?? 0) - burst.originX);
        if (dist < bestDist) {
          bestDist = dist;
          best = lem;
        }
      }
      if (best && manager.doLemmingAction(best, SkillTypes.BUILDER)) {
        const tick = this.game?.getGameTimer?.().tickIndex ?? 0;
        this._noteAiAction(best, tick, 48, {
          action: 'builder',
          reason: 'fall-recovery',
          skillType: SkillTypes.BUILDER,
          spent: true,
          targetX: burst.originX
        });
        burst.used?.add?.(best.id);
        return true;
      }
      return false;
    }
    const start = Math.max(0, this._builderCursorId);
    for (let i = 0; i < lems.length; i++) {
      const idx = (start + i) % lems.length;
      const lem = lems[idx];
      if (!lem || lem.removed || lem.disabled) continue;
      if (!this._isAssignableAction(lem)) continue;
      this._builderCursorId = idx + 1;
      if (manager.doLemmingAction(lem, SkillTypes.BUILDER)) {
        const tick = this.game?.getGameTimer?.().tickIndex ?? 0;
        this._noteAiAction(lem, tick, 48, {
          action: 'builder',
          reason: 'builder-burst',
          skillType: SkillTypes.BUILDER,
          spent: true
        });
        return true;
      }
    }
    return false;
  },

  _fillProcgenChallengeGround(mask, width, height, x0, x1, y0, groundHeight) {
    const startX = Math.max(0, Math.floor(x0));
    const endX = Math.min(width, Math.ceil(x1));
    const startY = Math.max(0, Math.floor(y0));
    const endY = Math.min(height, Math.ceil(y0 + groundHeight));
    for (let y = startY; y < endY; y += 1) {
      const row = y * width;
      for (let x = startX; x < endX; x += 1) {
        mask[row + x] = 1;
      }
    }
  },

  _createGapChallengeFixture(gapStart, gapWidth) {
    const width = Math.max(72, Math.floor(gapWidth) + 64);
    const height = 48;
    const footY = 24;
    const supportY = footY + 1;
    const leftEnd = 24;
    const rightStart = leftEnd + Math.max(0, Math.floor(gapWidth));
    const groundMask = new Uint8Array(width * height);
    this._fillProcgenChallengeGround(groundMask, width, height, 0, leftEnd, supportY, this.groundHeight);
    this._fillProcgenChallengeGround(groundMask, width, height, rightStart, width, supportY, this.groundHeight);
    return {
      kind: 'procgen-local-challenge',
      id: `procgen-gap-${Math.floor(gapStart)}-${Math.floor(gapWidth)}`,
      width,
      height,
      groundMask,
      steelMask: new Uint8Array(width * height),
      entrances: [{ x: 8, y: footY }],
      exits: [{ x: Math.min(width - 8, rightStart + 24), y: footY }],
      lemmings: [{ id: 0, x: 8, y: footY, lookRight: true, action: 'walking' }],
      skills: { builder: 1 },
      challenge: {
        type: 'builder-gap',
        sourceStartX: Math.floor(gapStart),
        sourceWidth: Math.floor(gapWidth)
      }
    };
  },

  _createGapChallengeCertificate(gapStart, gapWidth) {
    const localGapStart = 24;
    const localGapEnd = localGapStart + Math.max(0, Math.floor(gapWidth));
    return createProcgenChallengeCertificate({
      id: `procgen-gap-${this._recentCertificateSerial + 1}-${Math.floor(gapStart)}`,
      challengeType: PROCGEN_CHALLENGE_TYPES.BRIDGE_GAP,
      expectedSkill: 'builder',
      assignmentWindow: { start: 20, end: 80 },
      expectedLandingSegment: {
        x0: localGapEnd,
        y0: 24,
        x1: localGapEnd + 16,
        y1: 24
      },
      expectedExitSegment: {
        x0: localGapEnd + 16,
        y0: 24,
        x1: localGapEnd + 32,
        y1: 24
      },
      minimalSkillCount: 1
    });
  },

  _getAssistChallengeType(option) {
    if (!option) return null;
    if (option.key === 'builder' && option.reason === 'small-gap') {
      return PROCGEN_CHALLENGE_TYPES.BRIDGE_GAP;
    }
    if (option.key === 'floater' && option.reason === 'unsafe-drop') {
      return PROCGEN_CHALLENGE_TYPES.FALL_SURVIVAL;
    }
    if (option.key === 'bash') return PROCGEN_CHALLENGE_TYPES.BASH_BARRIER;
    if (option.key === 'dig') return PROCGEN_CHALLENGE_TYPES.DIG_BARRIER;
    if (option.key === 'mine') return PROCGEN_CHALLENGE_TYPES.MINE_SLOPE;
    return null;
  },

  _getAssistChallengeSkillName(option) {
    if (!option) return null;
    if (option.key === 'bash') return 'basher';
    if (option.key === 'dig') return 'digger';
    if (option.key === 'mine') return 'miner';
    if (option.key === 'builder') return 'builder';
    if (option.key === 'floater') return 'floater';
    return option.key || null;
  },

  _createAssistChallengeCertificate(option, lemming, scan, tick) {
    const challengeType = this._getAssistChallengeType(option);
    if (!challengeType) return null;
    const localTargetX = challengeType === PROCGEN_CHALLENGE_TYPES.BRIDGE_GAP
      ? 48
      : 62;
    return createProcgenChallengeCertificate({
      id: `procgen-assist-${this._recentCertificateSerial + 1}-${challengeType}`,
      challengeType,
      expectedSkill: this._getAssistChallengeSkillName(option),
      assignmentWindow: {
        start: Math.max(0, Math.floor((tick ?? 0) - 8)),
        end: Math.max(0, Math.floor((tick ?? 0) + 16))
      },
      expectedLandingSegment: {
        x0: localTargetX,
        y0: 57,
        x1: localTargetX + 18,
        y1: 57
      },
      expectedExitSegment: {
        x0: 104,
        y0: 57,
        x1: 120,
        y1: 57
      },
      minimalSkillCount: 1,
      source: {
        reason: option.reason,
        lemmingId: lemming?.id ?? null,
        scan
      }
    });
  },

  _createBarrierChallengeFixture(option, scan) {
    const width = 140;
    const height = 72;
    const footY = 57;
    const supportY = footY + 1;
    const barrierHeight = Math.max(4, Math.min(24, Math.floor(scan?.wall?.height ?? 10)));
    const groundMask = new Uint8Array(width * height);
    const steelMask = new Uint8Array(width * height);
    this._fillProcgenChallengeGround(groundMask, width, height, 0, width, supportY, this.groundHeight);
    this._fillProcgenChallengeGround(
      groundMask,
      width,
      height,
      62,
      70,
      footY - barrierHeight + 1,
      barrierHeight
    );
    const skillName = this._getAssistChallengeSkillName(option);
    return {
      kind: 'procgen-local-challenge',
      id: `procgen-${option?.key || 'barrier'}-barrier`,
      width,
      height,
      groundMask,
      steelMask,
      entrances: [{ x: 12, y: footY }],
      exits: [{ x: 120, y: footY }],
      lemmings: [{ id: 0, x: 20, y: footY, lookRight: true, action: 'walking' }],
      skills: skillName ? { [skillName]: 1 } : {},
      challenge: {
        type: option?.key === 'dig'
          ? 'dig-barrier'
          : option?.key === 'mine'
            ? 'mine-barrier'
            : 'bash-barrier',
        sourceHeight: barrierHeight
      }
    };
  },

  _createFallChallengeFixture(scan, tick) {
    const width = 120;
    const height = 140;
    const footY = 23;
    const supportY = footY + 1;
    const safeFall = Math.max(1, Math.floor(this.maxDrop || 60));
    const fallDistance = Math.max(
      safeFall + 8,
      Math.floor(scan?.gap?.drop ?? this.aiFloaterDrop ?? safeFall) + 8,
      72
    );
    const landingFootY = Math.min(height - this.groundHeight - 2, footY + fallDistance);
    const groundMask = new Uint8Array(width * height);
    this._fillProcgenChallengeGround(groundMask, width, height, 0, 32, supportY, this.groundHeight);
    this._fillProcgenChallengeGround(
      groundMask,
      width,
      height,
      48,
      width,
      landingFootY + 1,
      this.groundHeight
    );
    return {
      kind: 'procgen-local-challenge',
      id: 'procgen-floater-fall',
      width,
      height,
      groundMask,
      steelMask: new Uint8Array(width * height),
      entrances: [{ x: 10, y: footY }],
      exits: [{ x: 104, y: landingFootY }],
      lemmings: [{ id: 0, x: 12, y: footY, lookRight: true, action: 'walking' }],
      skills: { floater: 1 },
      challenge: {
        type: 'floater-fall'
      },
      fall: {
        x: 34,
        fromY: footY,
        toY: landingFootY,
        safeFallDistance: safeFall,
        assignmentTick: Math.max(0, Math.floor(tick ?? 0))
      }
    };
  },

  _createAssistChallengeFixture(option, lemming, scan, tick) {
    const challengeType = this._getAssistChallengeType(option);
    if (!challengeType) return null;
    if (challengeType === PROCGEN_CHALLENGE_TYPES.BRIDGE_GAP) {
      return this._createGapChallengeFixture(
        Number.isFinite(option?.targetX) ? option.targetX : lemming?.x ?? 0,
        scan?.gap?.width ?? 4,
        lemming?.y
      );
    }
    if (challengeType === PROCGEN_CHALLENGE_TYPES.FALL_SURVIVAL) {
      return this._createFallChallengeFixture(scan, tick);
    }
    return this._createBarrierChallengeFixture(option, scan);
  },

  _normalizeVerifierOutput(output, certificate) {
    if (output?.verificationResult) return output;
    return createProcgenChallengeCertificate({
      ...certificate,
      verificationResult: output
    });
  },

  _verifyGeneratedGap(gapStart, gapWidth, surfaceY) {
    const certificate = this._createGapChallengeCertificate(gapStart, gapWidth);
    const chunk = this._createGapChallengeFixture(gapStart, gapWidth, surfaceY);
    let verified = null;
    let fallback = {
      decision: PROCGEN_FALLBACK_DECISIONS.ACCEPT,
      resultType: 'skipped',
      reasonCodes: [],
      summary: 'Procgen certificate verification is disabled'
    };
    if (this.procgenCertificateVerification) {
      const options = {
        ...this.procgenCertificateOptions,
        controller: this
      };
      const raw = this.procgenCertificateVerifier
        ? this.procgenCertificateVerifier(certificate, chunk, options)
        : verifyProcgenChallengeCertificateSync(certificate, chunk, options);
      verified = this._normalizeVerifierOutput(raw, certificate);
      fallback = decideProcgenFallback(verified.verificationResult);
    } else {
      verified = certificate;
    }
    this._trackProcgenCertificate(verified, fallback, {
      startX: gapStart,
      endX: gapStart + gapWidth,
      width: gapWidth,
      surfaceY
    });
    return {
      certificate: verified,
      fallback,
      accepted: fallback.decision === PROCGEN_FALLBACK_DECISIONS.ACCEPT
    };
  },

  _verifyAssistChallenge(option, lemming, scan, tick) {
    const certificate = this._createAssistChallengeCertificate(option, lemming, scan, tick);
    const chunk = certificate
      ? this._createAssistChallengeFixture(option, lemming, scan, tick)
      : null;
    if (!certificate || !chunk) return null;
    let verified = null;
    let fallback = {
      decision: PROCGEN_FALLBACK_DECISIONS.ACCEPT,
      resultType: 'skipped',
      reasonCodes: [],
      summary: 'Procgen certificate verification is disabled'
    };
    if (this.procgenCertificateVerification) {
      const options = {
        ...this.procgenCertificateOptions,
        controller: this
      };
      const raw = this.procgenCertificateVerifier
        ? this.procgenCertificateVerifier(certificate, chunk, options)
        : verifyProcgenChallengeCertificateSync(certificate, chunk, options);
      verified = this._normalizeVerifierOutput(raw, certificate);
      fallback = decideProcgenFallback(verified.verificationResult);
    } else {
      verified = certificate;
    }
    this._trackProcgenCertificate(verified, fallback, {
      source: 'assist',
      reason: option?.reason || null,
      lemmingId: lemming?.id ?? null,
      startX: option?.targetX ?? lemming?.x,
      endX: option?.targetX,
      width: scan?.gap?.width ?? scan?.wall?.height ?? null,
      surfaceY: lemming?.y
    });
    return {
      certificate: verified,
      fallback,
      accepted: fallback.decision === PROCGEN_FALLBACK_DECISIONS.ACCEPT
    };
  },

  _trackProcgenCertificate(verified, fallback, meta = {}) {
    this._recentCertificateSerial += 1;
    this._recentCertificates.push({
      serial: this._recentCertificateSerial,
      source: meta.source || 'terrain',
      reason: meta.reason || null,
      lemmingId: meta.lemmingId ?? null,
      id: verified?.id ?? null,
      challengeType: verified?.challengeType ?? PROCGEN_CHALLENGE_TYPES.UNKNOWN,
      expectedSkill: verified?.expectedSkill ?? null,
      resultType: fallback?.resultType ?? verified?.verificationResult?.resultType ?? null,
      decision: fallback?.decision ?? PROCGEN_FALLBACK_DECISIONS.ACCEPT,
      reasonCodes: Array.isArray(fallback?.reasonCodes) ? fallback.reasonCodes.slice() : [],
      summary: fallback?.summary ?? verified?.verificationResult?.summary ?? null,
      startX: Number.isFinite(meta.startX) ? Math.floor(meta.startX) : null,
      endX: Number.isFinite(meta.endX) ? Math.floor(meta.endX) : null,
      width: Number.isFinite(meta.width) ? Math.floor(meta.width) : null,
      surfaceY: Number.isFinite(meta.surfaceY) ? Math.floor(meta.surfaceY) : null
    });
    const limit = Math.max(1, Math.floor(this.recentCertificateLimit ?? 32));
    if (this._recentCertificates.length > limit) {
      this._recentCertificates.splice(0, this._recentCertificates.length - limit);
    }
  },

  _fallbackTerrainWidth(segmentWidth, gapWidth, fallback) {
    if (fallback?.decision === PROCGEN_FALLBACK_DECISIONS.EXTEND) {
      return Math.max(segmentWidth, gapWidth + this._pickSegmentWidth());
    }
    return Math.max(segmentWidth, gapWidth);
  },

  _ensureGround(rightmostX) {
    const levelWidth = this.level?.width ?? 0;
    if (!Number.isFinite(levelWidth) || levelWidth <= 0) return;
    const frontierX = Number.isFinite(rightmostX) ? rightmostX : this._getRightmostX();
    if (!Number.isFinite(frontierX)) return;
    while (this._needsGroundForFrontier(frontierX)) {
      if (this._groundEndX >= levelWidth) break;
      const segmentWidth = this._pickSegmentWidth();
      if (this._shouldInsertGap()) {
        const gapWidth = this._pickGapWidth();
        const gapStart = this._groundEndX;
        const verification = this._verifyGeneratedGap(gapStart, gapWidth, this._groundTopY);
        if (!verification.accepted) {
          const fallback = verification.fallback;
          if (fallback.decision === PROCGEN_FALLBACK_DECISIONS.SIMPLIFY) {
            const simplifiedWidth = Math.max(2, Math.min(gapWidth, 8));
            if (simplifiedWidth < gapWidth) {
              this._gaps.push({
                x: gapStart,
                width: simplifiedWidth,
                y: this._groundTopY,
                assigned: false,
                certificateDecision: fallback.decision,
                certificateResultType: fallback.resultType
              });
              const simplifiedEnd = Math.min(levelWidth, this._groundEndX + simplifiedWidth);
              this._trackGeneratedChunk({
                type: 'gap',
                startX: gapStart,
                endX: simplifiedEnd,
                y: this._groundTopY,
                certificateDecision: fallback.decision,
                certificateResultType: fallback.resultType
              });
              this._groundEndX = simplifiedEnd;
              this._refreshLookaheadTarget();
              this._gapCooldown = this._randInt(16, 40);
              continue;
            }
          }
          const fallbackWidth = this._fallbackTerrainWidth(segmentWidth, gapWidth, fallback);
          const nextTop = this._pickNextTopY();
          const colorIndex = this._getNextColorIndex();
          const fallbackStart = this._groundEndX;
          this._paintGround(fallbackStart, fallbackWidth, nextTop, colorIndex);
          this._groundTopY = nextTop;
          this._groundEndX = Math.min(levelWidth, this._groundEndX + fallbackWidth);
          this._trackGeneratedChunk({
            type: 'solver-fallback',
            originalType: 'gap',
            startX: fallbackStart,
            endX: this._groundEndX,
            topY: nextTop,
            colorIndex,
            certificateDecision: fallback.decision,
            certificateResultType: fallback.resultType
          });
          this._refreshLookaheadTarget();
          this._gapCooldown = this._randInt(12, 28);
          continue;
        }
        this._gaps.push({
          x: gapStart,
          width: gapWidth,
          y: this._groundTopY,
          assigned: false,
          certificateDecision: verification.fallback.decision,
          certificateResultType: verification.fallback.resultType
        });
        const gapEnd = Math.min(levelWidth, this._groundEndX + gapWidth);
        this._trackGeneratedChunk({
          type: 'gap',
          startX: gapStart,
          endX: gapEnd,
          y: this._groundTopY,
          certificateDecision: verification.fallback.decision,
          certificateResultType: verification.fallback.resultType
        });
        this._groundEndX = gapEnd;
        this._refreshLookaheadTarget();
        this._gapCooldown = this._randInt(16, 40);
        continue;
      }
      const nextTop = this._pickNextTopY();
      const colorIndex = this._getNextColorIndex();
      const segmentStart = this._groundEndX;
      this._paintGround(segmentStart, segmentWidth, nextTop, colorIndex);
      this._groundTopY = nextTop;
      this._groundEndX = Math.min(levelWidth, this._groundEndX + segmentWidth);
      this._trackGeneratedChunk({
        type: 'terrain',
        startX: segmentStart,
        endX: this._groundEndX,
        topY: nextTop,
        colorIndex
      });
      this._refreshLookaheadTarget();
    }
    this._pruneGeneratedTracking(frontierX);
  },

  _paintGround(startX, width, topY, colorIndex) {
    if (this.assets && this.stamper) {
      this._paintGroundPieces(startX, width, topY, colorIndex);
      return;
    }
    this._paintGroundPixels(startX, width, topY, colorIndex);
  },

  _paintGroundPixels(startX, width, topY, colorIndex) {
    if (!this.level) return;
    const levelWidth = this.level.width;
    const levelHeight = this.level.height;
    const x0 = Math.max(0, startX);
    const x1 = Math.min(levelWidth, startX + width);
    const top = Number.isFinite(topY) ? topY : levelHeight - this.groundHeight;
    const y0 = Math.max(0, Math.min(levelHeight - this.groundHeight, top));
    const y1 = Math.min(levelHeight, y0 + this.groundHeight);
    const paletteIndex = Number.isFinite(colorIndex)
      ? colorIndex
      : this.groundColorIndex;
    if (typeof this.level.setGroundRect === 'function') {
      this.level.setGroundRect(x0, y0, x1 - x0, y1 - y0, paletteIndex, {
        recordHistory: false,
        invalidateMiniMap: true
      });
      return;
    }
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        this.level.setGroundAt(x, y, paletteIndex);
      }
    }
  },

  _paintGroundPieces(startX, width, topY, colorIndex) {
    if (!this.level || !this.assets || !this.stamper) return;
    const levelWidth = this.level.width;
    const maxX = Math.min(levelWidth, startX + width);
    const floorY = (Number.isFinite(topY) ? topY : 0) + this.groundHeight - 1;
    let cursor = Math.max(0, startX);
    const decorBias = Number.isFinite(colorIndex) ? (colorIndex % 4) : 0;
    const structure = this._getStructurePlan();
    let repeatPiece = null;
    while (cursor < maxX) {
      const remaining = maxX - cursor;
      let surfaceY = this._nextSurfaceY(structure, floorY);
      const minHeight = structure?.type === 'pillar'
        ? Math.max(this.groundHeight * 3, 8)
        : this.groundHeight;
      const minWidth = structure?.type === 'shelf'
        ? Math.max(6, this.segmentMinWidth)
        : 1;
      const repeatWidth = repeatPiece?.width ?? repeatPiece?.bounds?.width ?? 0;
      const piece = repeatPiece && remaining >= repeatWidth
        ? repeatPiece
        : this.assets.pickGroundPiece(remaining, minHeight, minWidth);
      if (!piece?.bounds?.width) break;
      if (!repeatPiece || this._rand() < 0.25) {
        repeatPiece = piece;
      }
      const stamped = structure?.type === 'pillar'
        ? this._stampVerticalRun(cursor, surfaceY, piece)
        : this._stampHorizontalRun(cursor, surfaceY, piece, maxX, decorBias);
      cursor += stamped;
      if (cursor >= maxX) break;
    }
  },

  _stampHorizontalRun(cursorX, surfaceY, piece, maxX, decorBias) {
    const pieceWidth = Math.max(1, piece.width || piece.bounds.width);
    const repeats = Math.max(1, Math.floor((maxX - cursorX) / pieceWidth));
    let stamped = 0;
    for (let i = 0; i < repeats; i++) {
      const destX = cursorX + stamped - piece.bounds.minX;
      const destY = this._clampSurfaceForEntrance(surfaceY, piece, cursorX + stamped) - piece.bounds.maxY;
      const rect = this.stamper.stamp(piece, destX, destY);
      this._trackGeneratedPiece(piece, destX, destY, 'ground', rect);
      if (this._rand() < (this.decorChance + decorBias * 0.01)) {
        this._placeDecoration(destX, destY, piece);
      }
      stamped += pieceWidth;
    }
    return stamped || pieceWidth;
  },

  _stampVerticalRun(cursorX, surfaceY, piece) {
    const pieceWidth = Math.max(1, piece.width || piece.bounds.width);
    const pieceHeight = Math.max(1, piece.height || piece.bounds.height);
    const repeats = Math.max(2, Math.ceil(this.groundHeight / pieceHeight));
    let topY = surfaceY;
    for (let i = 0; i < repeats; i++) {
      const destX = cursorX - piece.bounds.minX;
      const destY = topY - piece.bounds.maxY;
      const rect = this.stamper.stamp(piece, destX, destY);
      this._trackGeneratedPiece(piece, destX, destY, 'support', rect);
      topY -= pieceHeight;
    }
    return pieceWidth;
  }
};
export { procgenTerrainDirectorMethods };
