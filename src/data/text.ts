/**
 * All in-game text (Chinese). Rule text only: say what the thing does, with numbers.
 * No flavour text, no dialogue.
 */
import type { BossId, CyberId, ModId, Slot, WeaponId } from '../game/loadout';

export const WEAPON_TEXT: Record<WeaponId, { name: string; tag: string; primary: string; special: string }> = {
  riveter: {
    name: '钉枪',
    tag: '布置 → 收网',
    primary: '连发钉子。钉子会钉在头目、物体和墙上。弹匣 20，打完必须回收。',
    special: '回收：所有钉子飞回手里。拔出头目身上的钉子造成大量伤害，飞回途中穿过头目也会造成伤害。钉在油桶上的钉子会把油桶拽过来。',
  },
  arc: {
    name: '电弧枪',
    tag: '近身持续 · 导电',
    primary: '按住发射电弧，锁定准星方向最近的目标，并在头目、金属柱、油桶之间跳跃。命中积攒电量。持续电击会点燃油桶。',
    special: '过载：花掉全部电量（至少 25）扔出电球，0.7 秒后爆炸。电量越多伤害越高。让设备短路，击碎范围内软弹。',
  },
  breacher: {
    name: '霰弹枪',
    tag: '近距压制 · 推物体',
    primary: '8 颗弹丸，2 发后自动装填，距离越近伤害越高。弹丸会推开物体、击碎软弹。',
    special: '独头弹：打光剩余子弹，穿透一切，击飞物体，打碎护甲。后坐力 20 像素。',
  },
  blade: {
    name: '单分子刀',
    tag: '弹反 · 高风险',
    primary: '三段斩，第三段向前突进。挥刀时把碰到的子弹全部弹回去。',
    special: '拔刀：按住蓄力后松开，瞬间斩穿一条直线，连钢缆都能切断，全程无敌。拔刀期间完美闪避，可立即进行二段拔刀·光返（150% 伤害）。拔刀冷却 3 秒。',
  },
};

export const BREACHER_TEXT = { reloading: '装填', rampage: '狂暴模式' } as const;

export const BLADE_TEXT = { lightReturn: '光返', flow: '心流' } as const;

export const SLOT_TEXT: Record<Slot, { name: string; key: string }> = {
  legs: { name: '腿', key: '空格' },
  arm: { name: '臂', key: 'Q' },
  core: { name: '躯干', key: '被动' },
  head: { name: '头', key: '被动' },
};

export const CYBER_TEXT: Record<CyberId, { name: string; desc: string }> = {
  legs_stock: { name: '原厂腿', desc: '冲刺 70 像素，全程无敌，冷却 0.5 秒。' },
  legs_leap: { name: '弹跳活塞', desc: '冲刺变成跳跃：滞空 0.42 秒，越过地面攻击和障碍物。落地冲击波推开物体、击碎软弹。冷却 0.85 秒。' },
  legs_blink: { name: '相位步', desc: '冲刺变成瞬移（2 次充能）。原地留下 1.2 秒诱饵，头目会瞄准诱饵。瞬移时可以开火。' },
  legs_slide: { name: '液压滑铲', desc: '冲刺变成 130 像素的滑铲。滑铲中可以开火，铲飞物体，穿过头目并造成伤害。' },
  arm_shove: { name: '推掌', desc: 'Q：前方锥形冲击，推开物体，击碎软弹。冷却 2.5 秒。' },
  arm_grapple: { name: '抓钩', desc: 'Q：钩到油桶就拽到手里，再按 Q 扔出去；钩到墙、柱子或头目就把自己拉过去（途中无敌）；能远程拉动拉杆。' },
  arm_fist: { name: '液压拳', desc: 'Q：按住蓄力，松开出拳。击飞物体、把子弹打回去（软硬都行）。蓄力过半打掉护甲。满蓄力伤害 70。' },
  arm_jack: { name: '骇入臂', desc: 'Q：骇入准星附近的设备（吊车、拉杆、投影仪、接线盒）；对准头目则让它 4 秒内整体变慢 30%。冷却 8 秒。' },
  core_none: { name: '空', desc: '' },
  core_plating: { name: '反应装甲', desc: '+1 格护盾。10 秒没受伤就恢复。' },
  core_capacitor: { name: '电容脊柱', desc: '受伤时放出电磁脉冲，清除周围所有子弹并推开物体。冷却 12 秒。' },
  core_debt: { name: '债务芯', desc: '伤害 +40%。生命上限 −2。' },
  core_overclock: { name: '超频心脏', desc: '完美闪避后 4 秒内射速 +40%、移速 +20%。' },
  head_none: { name: '空', desc: '' },
  head_optics: { name: '战术目镜', desc: '弱点伤害 ×1.8（原本 ×1.3）。头目所有预告时间 +15%。' },
  head_reflex: { name: '神经加速', desc: '完美闪避触发 1.4 秒子弹时间，你不受减速影响。' },
  head_ballistic: { name: '弹道协处理', desc: '子弹轻微追踪头目。刀、电弧、抓钩范围 +25%。' },
};

export const MOD_TEXT: Record<ModId, { name: string; desc: string }> = {
  riveter_barbed: { name: '倒刺', desc: '钉在头目身上的钉子，每根每秒造成 0.8 伤害。' },
  riveter_magnet: { name: '磁轨', desc: '回收时钉子飞向按下右键时的准星位置，而不是你。' },
  riveter_blast: { name: '爆破钉', desc: '一次从同一目标回收至少 4 枚钉子，触发半径 40 的爆炸；每枚钉子额外 6 伤害。' },
  arc_mine: { name: '电容地雷', desc: '过载电球落地后变成地雷，头目靠近才爆炸（最多等 8 秒），伤害 ×1.5。' },
  arc_web: { name: '导体网', desc: '电弧多跳 3 次。从金属柱、油桶跳出的距离 ×1.6。' },
  arc_aftershock: { name: '余震', desc: '电球爆炸后留下 3 秒电场，半径 56。每 0.5 秒脉冲造成 8 伤害，击碎软弹。' },
  breacher_dragon: { name: '龙息', desc: '弹丸点燃油桶和地面，留下持续 2.5 秒的火焰。弹丸伤害 −20%。' },
  breacher_recoil: { name: '反冲', desc: '换上高爆弹。独头弹伤害 +60%，后坐力增加 60 像素，后退期间无敌。' },
  breacher_overload: { name: '过载', desc: '强行装下弹丸，进入狂暴模式：每发 15 颗弹丸，攻击距离 +20%。' },
  blade_return: { name: '原路奉还', desc: '弹回的子弹追踪头目，伤害 ×2。' },
  blade_afterimage: { name: '残影', desc: '拔刀的斩线 0.5 秒后再斩一次（该次拔刀 70% 伤害）。' },
  blade_flow: { name: '心流', desc: '拔刀期间完美闪避，进入 1 秒心流：拔刀免蓄力、无冷却。心流内完美闪避刷新至 1 秒。' },
};

export const BOSS_TEXT: Record<BossId, { name: string; en: string; place: string }> = {
  gearjaw: { name: '齿颚', en: 'GEARJAW', place: '锈港 · 压实场' },
  lux: { name: '卢克丝夫人', en: 'MADAME LUX', place: '霓虹集市 · 夜店舞台' },
  octohydra: { name: '八头蛇', en: 'OCTOHYDRA', place: '下网 · 淹水机房' },
  kade: { name: '凯德主管', en: 'DIRECTOR KADE', place: 'Skyline 区 · 天台停机坪' },
  vesper: { name: '维斯珀', en: 'VESPER', place: '环线列车 · 车顶' },
  kairo: { name: '校时员·刻洛', en: 'KAIRO', place: '下网 · 记忆备份站' },
  fold: { name: '建筑师·折尺', en: 'FOLD', place: 'Skyline 区 · 模块建筑工地' },
  wren: { name: '潜网客·芮恩', en: 'WREN', place: '地下黑网吧 · 双层' },
};

export const KAIRO_TEXT = {
  name: '校时员·刻洛', record: '封存回放', release: '释放回放', empty: '暂无回放', stored: '已封存',
  breaker: '时间断路', coolant: '冷却喷流', paused: '回放暂停', rewind: '回溯',
  phase2: '归档快门', phase3: '双重曝光', replay: '回放', captured: '封存',
  recording: '录制轨迹', trace: '逆行残像', shutter: '归档快门', hand: '借秒钟摆', returnSpot: '归档位',
  rush: '追秒连斩', haste: '时间加速', slow: '时间迟滞', synchronizing: '校时',
  hint: '断路器恢复时间 · 快门回到旧位置 · 刀可切秒针',
} as const;

export const FOLD_TEXT = {
  name: '建筑师·折尺', route: '调度平台', brake: '紧急制动', press: '启动压机', gate: '升降隔离闸',
  moving: '平台移动', stopped: '制动', phase2: '双台拼接', phase3: '中心工作台',
  rooms: ['切割间', '仓储间', '控制间', '装配间'] as const,
  hint: '调度平台携带物体 · 冲锋撞隔墙会瘫痪 · 制动与压机可打断施工',
} as const;

export const DAFEYU_TEXT = {
  name: '大肥鱼',
  interact: '脑机接口升级',
  title: '脑机接口',
  talent: '天赋加点',
  rule: '使用游戏代币升级脑机接口。',
  pending: '待开发',
  unavailable: '升级暂未开放',
  close: '关闭',
} as const;

export const UI = {
  title: '逾期',
  start: '开始',
  mute: '声音',
  on: '开',
  off: '关',
  chooseWeapon: '选择武器',
  primary: '左键',
  special: '右键',
  pause: '暂停',
  resume: '继续',
  abandon: '放弃本局（回到据点）',
  victory: '清算完成',
  defeat: '被收回',
  chooseReward: '选择一项',
  loan: '贷款合同',
  loanHint: '多拿一张，代价写在合同上',
  replaces: '替换',
  newPart: '新部位',
  backToTitle: '回到标题',
  fight: '第 {n} 场',
  controls: 'WASD 移动   鼠标 瞄准   左键 攻击   右键 特技   空格 冲刺   Q 手臂   E 互动   Esc 暂停',
  stats: { time: '用时', hits: '受伤', dodges: '完美闪避', staggers: '瘫痪', env: '场地伤害' },
};
