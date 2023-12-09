
const SettingsUI = require('tera-mod-ui').Settings

module.exports = function warrior(mod) {
	
	let ui = null
	if (global.TeraProxy.GUIMode) {
		ui = new SettingsUI(mod, require('./settings_structure'), mod.settings, { height: 390 })
		ui.on('update', settings => {
			mod.settings = settings
		})
		
		this.destructor = () => {
			if (ui) {
				ui.close()
				ui = null
			}
		}
	}		
	const options = mod.settings
	const { player } = mod.require.library;
	mod.game.initialize("me.abnormalities");
	mod.game.initialize('inventory');
	
	let myPosition,
		myAngle,
		replaced = false,
		blocked = false,
		intervalId = null,
		packet_structure = [],
		my_re = 0,
		lastSkillGroup = null,
		lastSkill = null,
		aspd = null,
		isCD_root = false,
		edge = 0,
		aerial_timeout = null,
		rising_timeout = null,
		dps = null,
		distance_limit = 200,
		advanced_skills_glyphs = null,
		fastskills = require("./fastskills.js"),
		lastTimeout = null,
		skillLocksTimer = null;
    const skillLocks = new Set();		
	
	class Skill {
	  constructor(id, group, stage, stageId, stageDelay = null) {
		this.id = id;
		this.group = group;
		this.stage = stage;
		this.stageId = stageId;
		this.stageDelay = stageDelay;
		this.isOnCooldown = false;
		this.cooldownDuration = 0;
		this.cooldownTimer = null;
		this.cooldownStart = null;
	  }
	  startCooldown(duration) {
		if (this.cooldownTimer) {
		  clearTimeout(this.cooldownTimer);
		  this.cooldownTimer = null;
		}
		this.cooldownDuration = duration;
		this.isOnCooldown = true;
		this.cooldownStart = Date.now();
		this.cooldownTimer = setTimeout(() => {
		  this.resetCooldown();
		}, duration);
	  }
	  resetCooldown() {
		this.isOnCooldown = false;
		this.cooldownDuration = 0;
		this.cooldownStart = null;
		if (this.cooldownTimer) {
		  clearTimeout(this.cooldownTimer);
		  this.cooldownTimer = null;
		}
	  }
	  getRemainingCooldown() {
		if (!this.isOnCooldown) {
		  return 0;
		}
		const elapsed = Date.now() - this.cooldownStart;
		return Math.max(0, this.cooldownDuration - elapsed);
	  }	  
	}

	const skills = {
	  gamble: new Skill(200200, 20, 0, 200200, 400),
	  waltz: new Skill(400110, 40, 0, 400110, 500),
	  waltz_d: new Skill(400120, 40, 0, 400120, 500),
	  traverse: new Skill(281030, 28, 0, 281030, 1000),
	  traverse_d: new Skill(390130, 28, 0, 390130, 1000),
	  rain: new Skill(360130, 36, 0, 360130, 8000),
	  draw: new Skill(370130, 37, 0, 370130, 500),
	  scythe: new Skill(380130, 38, 0, 380130, 800),
	  aerial_1: new Skill(410100, 41, 0, 410100, 500),
	  aerial_2: new Skill(410131, 41, 0, 410131, 500),
	  reaping: new Skill(310830, 31, 0, 310830, 500),
	  frenzy: new Skill(420130, 42, 0, 420130, 8),
	  poison: new Skill(111100, 11, 0, 111100, 500),
	  combative: new Skill(181101, 18, 0, 181101, 500),
	  combative_d: new Skill(181102, 18, 0, 181102, 500),
	  rising_1: new Skill(191100, 19, 0, 191100, 500),
	  rising_2: new Skill(191101, 19, 0, 191101, 500),
	  d_stance: new Skill(90200, 9, 0, 90200, 500),
	  a_stance: new Skill(80400, 8, 0, 80400, 500),
	  infuriate: new Skill(350100, 35, 0, 350100, 500),
	  torrent: new Skill(30300, 3, 0, 30300, 500),
	  charging: new Skill(161000, 16, 0, 161000, 500),
	  vortex: new Skill(170702, 17, 0, 170702, 500)
	};
	
	const skillIdToNameMap = {};
	for (const skillName in skills) {
	  const skill = skills[skillName];
	  skillIdToNameMap[skill.id] = skillName;
	}
	const skillGroupToNameMap = {};
	for (const skillName in skills) {
	  const skill = skills[skillName];
	  skillGroupToNameMap[skill.group] = skillName;
	}	
	
	//Buffs IDs
	const assault_stance_abn = 100103;
	const def_stance_abn = 100201;
	const deadly_gamble_abn = 100801;
	const traverse_abn = 101300;
	const aerial_abn = 105100;
	const endurance_abn = 101210;
	
	const root_id = 80081;
	let broochID = null
	let isCD_brooch = false	
	
	const dpsModeRequirements = {
	  '102': 17010402,
	  '104': 17012002
	};
	const tankModeRequirements = {
	  '102': 17010401,
	  '104': 17012001
	};

	//Fast animations
    const hooks = [
        { name: "S_ACTION_STAGE", version: 9, order: -1000000, filter: { fake: null }, callback: handleActionStage },
        { name: "S_ACTION_END", version: 5, order: -1000000, filter: { fake: true }, callback: handleActionEnd },
        { name: "C_CANCEL_SKILL", version: 3, order: -1000000, filter: {}, callback: handleCancelSkill },
        { name: "S_EACH_SKILL_RESULT", version: 14, order: -10000000, filter: {}, callback: handleSkillResult }
    ];
	hooks.forEach(hook => mod.hook(hook.name, hook.version, { order: hook.order, filter: hook.filter }, hook.callback));	

	
	mod.command.add('warrior', () => {
		options.enabled = !options.enabled
		mod.command.message(`warrior mod is now ${(options.enabled) ? 'en' : 'dis'}abled.`)
	});

	mod.command.add('warriord', (arg) => {
		if(arg) {
			distance_limit = Number(arg);
			mod.command.message("Distance limit set to: " + distance_limit)
		}
	});	
	
	mod.command.add("wui", () => { if (ui) ui.show() });
	
	mod.hook('S_LOAD_TOPO', 3, event => {
		broochID = mod.game.inventory.equipment.slots[20];	
	})
	mod.hook('S_RP_SKILL_POLISHING_LIST', 1, event => {
		if(mod.game.me.class !== 'warrior') return	
		advanced_skills_glyphs = event
	})

	
	mod.hook('S_PLAYER_STAT_UPDATE',14, (event) => {
		aspd = (event.attackSpeed + event.attackSpeedBonus) /100;
		edge = event.edge;
	})	

	mod.hook('S_START_COOLTIME_ITEM', 1, event => {
		if(event.item == root_id) {
			isCD_root = true;
			setTimeout(function () {
				isCD_root = false
			}, event.cooldown * 1000);			
		};
		if (broochID && event.item == broochID.id) {
			isCD_brooch = true
			setTimeout(function () {
				isCD_brooch = false
			}, event.cooldown * 1000)
		}		
	});	
	mod.hook('S_SKILL_CATEGORY', 3, event => {
		if(!options.enabled) return
		if(mod.game.me.class !== 'warrior') return		
	});

	mod.hook('S_PLAYER_CHANGE_STAMINA', 1, event => {
		if(!options.enabled) return
		if(mod.game.me.class !== 'warrior') return
		my_re = event.current;
	});	

	mod.hook('S_PLAYER_STAT_UPDATE', 14, event => {
		if(!options.enabled) return
		if(mod.game.me.class !== 'warrior') return
		});
			
	mod.hook('S_LOAD_TOPO', 3, event => {
		lastSkill = null;
	});

	mod.hook('S_START_COOLTIME_SKILL', 3, {order: -999999}, event => {
		if (!options.enabled) return;
		if (mod.game.me.class !== 'warrior') return;		
		const skillName = skillIdToNameMap[event.skill.id];
		let skill = skills[skillName];
		if (skill) {
			skill.startCooldown(event.cooldown);
		}	
	});

	mod.hook('S_DECREASE_COOLTIME_SKILL', 3, {order: -999999}, event => {
		if (!options.enabled) return;
		if (mod.game.me.class !== 'warrior') return;	
		const skillName = skillIdToNameMap[event.skill.id];
		let skill = skills[skillName];
		if (skill) {
			skill.startCooldown(event.cooldown);
		}
	});		

	
	mod.hook('C_START_SKILL', 7, { order: 9999999, filter: { fake: false } }, (event) => {
		if(!options.enabled) return
		if(mod.game.me.class !== 'warrior') return
		replaced = false
		if(!broochID) broochID = mod.game.inventory.equipment.slots[20];
		if(event.skill.id===11200) {
			if(blocked) return false
			if(advanced_skills_glyphs) {
				const isDps = true;
				dps = checkDpsModeStatus(advanced_skills_glyphs.optionEffects, isDps);
			}		
					packet_structure = event;
					packet_structure.loc = global.sharedTeraState.myPosition;

					if(dps && !mod.game.me.abnormalities[assault_stance_abn] && !skills.a_stance.isOnCooldown && !replaced && !blocked) {
						packet_structure.skill.id = skills.a_stance.id;
						mod.send('C_START_SKILL', 7, packet_structure);
						lastSkill = skills.a_stance.id;
						return false
					}					
					if(!dps && !mod.game.me.abnormalities[def_stance_abn] && !skills.d_stance.isOnCooldown && !replaced && !blocked) {
						packet_structure.skill.id = skills.d_stance.id;
						mod.send('C_START_SKILL', 7, packet_structure);
						lastSkill = skills.d_stance.id;
						return false
					}
					if(!dps && options.infuriate && !skills.infuriate.isOnCooldown && !global.sharedTeraState.enraged && global.sharedTeraState.bossId && global.sharedTeraState.bossLoc && (global.sharedTeraState.distanceFromBoss <= distance_limit) && !replaced && !blocked) {
						packet_structure.skill.id = skills.infuriate.id;
						mod.send('C_START_SKILL', 7, packet_structure);
						blocked = true;
						setTimeout(function () { blocked = false; }, 1000 / aspd);
						lastSkill = packet_structure.skill.id;
						return false
					}					
					if(options.root && !isCD_root && mod.game.me.abnormalities[deadly_gamble_abn] && (mod.game.inventory.getTotalAmountInBag(root_id) > 0)) {
						use_item(root_id);
					}
					if(options.brooch && !isCD_brooch && mod.game.me.abnormalities[deadly_gamble_abn]) {
						use_item(broochID.id);
					}					
					if(options.boss && global.sharedTeraState.bossId && global.sharedTeraState.bossLoc && (global.sharedTeraState.distanceFromBoss <= distance_limit)) {
						packet_structure.w = global.sharedTeraState.AngleToFaceBoss;
						packet_structure.target = global.sharedTeraState.bossId;
						event.w = global.sharedTeraState.AngleToFaceBoss;
						event.target = global.sharedTeraState.bossId;						
					}
					if(!dps && options.endurance && !skills.combative_d.isOnCooldown && global.sharedTeraState.bossId && !global.sharedTeraState.bossAbnormalities[endurance_abn] && (global.sharedTeraState.distanceFromBoss <= distance_limit) && !replaced && !blocked) {
						packet_structure.skill.id = skills.combative_d.id;
						set_send_instance(packet_structure);
						lastSkill = packet_structure.skill.id;
						return false
					}					
					if(options.frenzy && !skills.frenzy.isOnCooldown && (lastSkill == skills.aerial_1.id || lastSkill == skills.scythe.id) && global.sharedTeraState.enraged && global.sharedTeraState.bossId && global.sharedTeraState.bossLoc && (global.sharedTeraState.distanceFromBoss <= distance_limit) && !replaced && !blocked) {
						packet_structure.skill.id = skills.frenzy.id;
						blocked = true;
						setTimeout(function () { blocked = false; }, 2000 / aspd);
						set_send_instance(packet_structure);
						lastSkill = packet_structure.skill.id;
						return false
					}					
					if(options.traverse && !skills.traverse.isOnCooldown && (!mod.game.me.abnormalities[traverse_abn] || (mod.game.me.abnormalities[traverse_abn] && (mod.game.me.abnormalities[traverse_abn].stacks < 13)) || (mod.game.me.abnormalities[traverse_abn] && (mod.game.me.abnormalities[traverse_abn].remaining < 3000))) && !replaced && !blocked) {
						
						packet_structure.skill.id = dps ? skills.traverse.id : skills.traverse_d.id;
						set_send_instance(packet_structure);
						lastSkill = skills.traverse.id;						
						return false
					}					
					if(options.gamble && !skills.gamble.isOnCooldown && !mod.game.me.abnormalities[deadly_gamble_abn] && global.sharedTeraState.bossId && global.sharedTeraState.bossLoc && (global.sharedTeraState.distanceFromBoss <= distance_limit) && !replaced && !blocked) {
						packet_structure.skill.id = skills.gamble.id;
						set_send_instance(packet_structure);
						lastSkill = packet_structure.skill.id;						
						return false
					}
					if(!options.nocdaerial && options.aerial && !skills.aerial_1.isOnCooldown && (edge > 7) && !replaced && !blocked) {
						packet_structure.skill.id = skills.aerial_1.id;
						mod.send('C_START_SKILL', 7, packet_structure);
						blocked = true;
						const aerial_delay = (edge == 10) ? 100 : 1100;
						aerial_timeout = mod.setTimeout(() => { 
							mod.send('C_START_SKILL', 7, packet_structure); aerial_timeout = null; blocked = false;
						
						}, aerial_delay / aspd);
						lastSkill = packet_structure.skill.id;						
						return false
					}
					if(options.nocdaerial && options.aerial && !skills.aerial_1.isOnCooldown && (edge == 10) && !replaced && !blocked) {
						packet_structure.skill.id = skills.aerial_2.id;
						send_instance(packet_structure);
						lastSkill = skills.aerial_1.id;						
						return false
					}									
					
					if(!options.permagamble && options.scythe && !skills.scythe.isOnCooldown && (edge == 10) && (lastSkill != skills.aerial_1.id) && !replaced && !blocked) {
						packet_structure.skill.id = mod.game.me.abnormalities[deadly_gamble_abn] ? skills.scythe.id : 300930;
						set_send_instance(packet_structure);
						lastSkill = skills.scythe.id;						
						return false
					}
					if(options.permagamble && options.scythe && !skills.scythe.isOnCooldown && (edge == 10) && (lastSkill != skills.aerial_1.id) && !replaced && !blocked) {
						packet_structure.skill.id = skills.scythe.id;
						set_send_instance(packet_structure);
						lastSkill = skills.scythe.id;						
						return false
					}					
					if(!options.permagamble && options.draw && !skills.draw.isOnCooldown && !replaced && !blocked) {
						packet_structure.skill.id = mod.game.me.abnormalities[deadly_gamble_abn] ? skills.draw.id : 290930;
						set_send_instance(packet_structure);
						lastSkill = skills.draw.id;						
						return false
					}
					if(options.waltz && !skills.waltz.isOnCooldown && (lastSkill != skills.waltz.id) && !replaced && !blocked) {
						packet_structure.skill.id = dps ? skills.waltz.id : skills.waltz_d.id;
						mod.send('C_START_SKILL', 7, packet_structure);
						lastSkill = skills.waltz.id;						
						return false
					}					
					if(options.permagamble && options.draw && !skills.draw.isOnCooldown && !replaced && !blocked) {
						packet_structure.skill.id = skills.draw.id;
						set_send_instance(packet_structure);
						lastSkill = skills.draw.id;						
						return false
					}					
					if(!options.permagamble && options.rain && !skills.rain.isOnCooldown && !replaced && !blocked) {
						packet_structure.skill.id = mod.game.me.abnormalities[deadly_gamble_abn] ? skills.rain.id : 40930;
						set_send_instance(packet_structure);
						lastSkill = skills.rain.id;						
						return false
					}
					if(options.permagamble && options.rain && !skills.rain.isOnCooldown && !replaced && !blocked) {
						packet_structure.skill.id = skills.rain.id;
						set_send_instance(packet_structure);
						lastSkill = skills.rain.id;						
						return false
					}
					if(options.charging && !skills.charging.isOnCooldown && global.sharedTeraState.bossId && (global.sharedTeraState.distanceFromBoss <= 400)&& !replaced && !blocked) {
						packet_structure.skill.id = skills.charging.id;
						packet_structure.target = global.sharedTeraState.bossId;
						packet_structure.dest = global.sharedTeraState.bossLoc;
						set_send_instance(packet_structure);					
						lastSkill = skills.charging.id;
						return false
					}
					if(options.reaping && !skills.reaping.isOnCooldown && !replaced && !blocked) {
						packet_structure.skill.id = skills.reaping.id;
						set_send_instance(packet_structure);
						lastSkill = packet_structure.skill.id;						
						return false
					}
					if(options.rising && !skills.rising_1.isOnCooldown && !replaced && !blocked && (lastSkill !== skills.rising_2.id)) {
						packet_structure.skill.id = skills.rising_2.id;
						set_send_instance(packet_structure);
						lastSkill = skills.rising_2.id;
						return false
					}					
					if(options.combative && !skills.combative.isOnCooldown && !replaced && !blocked) {
						packet_structure.skill.id = dps ? skills.combative.id : skills.combative_d.id;
						set_send_instance(packet_structure);
						lastSkill = packet_structure.skill.id;						
						return false
					}
					if(options.torrent && !skills.torrent.isOnCooldown && !replaced && !blocked) {
						packet_structure.skill.id = skills.torrent.id;
						set_send_instance(packet_structure);
						lastSkill = packet_structure.skill.id;						
						return false
					}
					if(options.poison && !skills.poison.isOnCooldown && !replaced && !blocked) {
						packet_structure.skill.id = skills.poison.id;
						set_send_instance(packet_structure);
						lastSkill = packet_structure.skill.id;					
						return false
					}					
					if(!dps && options.vortex && !skills.vortex.isOnCooldown && !replaced && !blocked) {
						packet_structure.skill.id = skills.vortex.id;
						set_send_instance(packet_structure);
						lastSkill = packet_structure.skill.id;						
						return false
					}					
					if(options.traverse && !skills.traverse.isOnCooldown && !replaced && !blocked) {
						packet_structure.skill.id = dps ? skills.traverse.id : skills.traverse_d.id;
						set_send_instance(packet_structure);
						lastSkill = skills.traverse.id;						
						return false
					}									
					return false
										
		} else {
			lastSkill = null;
			return true
		}			
	});
	
	
    mod.hook('S_ACTION_STAGE', 9, { order: -9999999, filter: { fake: null } }, event => {
		if (options.enabled && (mod.game.me.class === 'warrior') && (mod.game.me.gameId === event.gameId) && (event.skill.id === skills.aerial_2.id) && (edge < 10)) {
			mod.command.message("Aerial: " + `<font color='#FE0000'>${(edge)}</font>` + " edge stacks.")
		}		
    });	

    function getSkillInfo(id) {
		let nid = id;
        return {
            id: nid,
            group: Math.floor(nid / 10000),
            level: Math.floor(nid / 100) % 100,
            sub: nid % 100
        };
    }

    function calculateAngle(playerLocation, enemyLocation) {
        const dx = enemyLocation.x - playerLocation.x;
        const dy = enemyLocation.y - playerLocation.y;
        let theta = Math.atan2(dy, dx); // Retorna el ángulo en radianes
        return theta;
    }
	
	
	function set_send_instance_low(a) {
		send_instance(a);
		setTimeout(function () { send_instance(a); }, 25);
	}	
	function set_send_instance(a) {
		send_instance(a);		
	}
	function send_instance(a) {
		mod.send('C_START_INSTANCE_SKILL', 7, {
			skill: {
				reserved: 0,
				npc: false,
				type: 1,
				huntingZoneId: 0,
				id: a.skill.id
			},
			loc: a.loc,
			w: a.w,
			continue: a.continue,
			targets: [{
				arrowId: 0,
				gameId: a.target,
				hitCylinderId: 0
			}],
			endpoints: [{x:a.dest.x, y:a.dest.y, z:a.dest.z}]
		});		
	}	

    function use_item(itemId) {
		mod.send('C_USE_ITEM', 3, {
			gameId: mod.game.me.gameId,
			id: itemId,
			dbid: 0,
			target: 0,
			amount: 1,
			dest: {
				x: 0,
				y: 0,
				z: 0
			},
			loc: global.sharedTeraState.myPosition,
			w: global.sharedTeraState.myAngle,
			unk1: 0,
			unk2: 0,
			unk3: 0,
			unk4: true
		})
	}
	function checkDpsModeStatus(optionEffects, isDps) {
	  const effectsMap = optionEffects.reduce((map, effect) => {
		if (!map[effect.group]) map[effect.group] = {};
		map[effect.group][effect.id] = effect.active;
		return map;
	  }, {});

	  for (let group in dpsModeRequirements) {
		const requiredId = dpsModeRequirements[group];
		
		if ((isDps && !effectsMap[group][requiredId]) || (!isDps && effectsMap[group][requiredId])) {
		  return false;
		}
	  }
	  return true;
	}
	
	function handleActionStage(event) {
		if (!isModuleEnabledForEvent(event)) return;

		const skillInfo = getSkillInfo(event);
		if (!skillInfo) return;

		handleSkillDelay(event, skillInfo);
		return handleSkillSpeedModification(event, skillInfo);
	}

	function isModuleEnabledForEvent(event) {
		return options.enabled && options.fastskills && mod.game.me.is(event.gameId) && mod.game.me.class === 'warrior';
	}

	function getSkillInfo(event) {
		const skillBaseId = Math.floor(event.skill.id / 1e4);
		return fastskills[mod.game.me.class].find(e => 
			e.id === skillBaseId &&
			(e.subId === undefined || e.subId === event.skill.id % (e.subId >= 100 ? 1000 : 100))			
		);
	}

	function handleSkillDelay(event, skillInfo) {
		if (skillInfo.delay && skillInfo.delay > 0) {
			skillLocks.add(event.skill.id);
			mod.clearTimeout(skillLocksTimer);

			skillLocksTimer = mod.setTimeout(() => skillLocks.delete(event.skill.id), 3000);

			lastTimeout = mod.setTimeout(() => sendSkillEnd(event, skillInfo), getDelayTime(skillInfo));
		}
	}

	function handleSkillSpeedModification(event, skillInfo) {
		if (skillInfo.speed && skillInfo.speed > 0) {
			const speed = (player.aspd / 100) * skillInfo.speed;
			event.speed += speed;
			event.projectileSpeed += speed;
			return true;
		}
	}

	function getDelayTime(skillInfo) {
		return skillInfo.delay / player.aspd;
	}

	function sendSkillEnd(event, skillInfo) {
		mod.send("S_ACTION_END", 5, {
			"gameId": event.gameId,
			"loc": event.loc,
			"w": event.w,
			"templateId": event.templateId,
			"skill": event.skill.id,
			"type": 12394123,
			"id": event.id
		});
	}
	
    function handleActionEnd(event) {
		if (!isModuleEnabledForEvent(event)) return;

		const skillBaseId = Math.floor(event.skill.id / 1e4);
		const skillInfo = fastskills[mod.game.me.class].find(e => e.id === skillBaseId && (e.subId === undefined || e.subId === event.skill.id % (e.subId >= 100 ? 1000 : 100)));

		skillLocks.delete(event.skill.id);
		mod.clearTimeout(skillLocksTimer);

		if (lastTimeout && skillInfo) {
			lastTimeout = null;
			if (event.type == 12394123) {
				event.type = 4;
				return true;
			}
			return false;
		}
    }

    function handleCancelSkill(event) {
		if (!options.enabled || !options.fastskills) return;

		skillLocks.delete(event.skill.id);
		mod.clearTimeout(skillLocksTimer);

		if (lastTimeout) {
			mod.clearTimeout(lastTimeout);
			lastTimeout = null;
		}
    }

    function handleSkillResult(event) {
		if (!options.enabled || !lastTimeout || !mod.game.me.is(event.target) || !event.reaction.enable) return;
		mod.clearTimeout(lastTimeout);
		lastTimeout = null;
    }	
	
}
