// v0.14 示例池：约 80 条，跨国家 / 年代 / 流派 / 媒介。空穗仓时随机抽 10 条，入库时打上 sample 标记，可一键清掉。
import type { Item, ItemType } from './types';
export type Sample = Omit<Item, 'id' | 'createdAt' | 'updatedAt'>;

const film = (title: string, creator: string, year: string, why: string, tags: string[]): Sample => ({ type: 'film', title, creator, year, why, tags });
const music = (title: string, creator: string, year: string, why: string, tags: string[]): Sample => ({ type: 'music', title, creator, year, why, tags });
const image = (title: string, creator: string, year: string, content: string, why: string, tags: string[]): Sample => ({ type: 'image', title, creator: creator || undefined, year: year || undefined, content, why, tags });
const text = (title: string, content: string, creator: string, why: string, tags: string[]): Sample => ({ type: 'text', title, content, creator, why, tags });
const idea = (title: string, content: string, why: string, tags: string[]): Sample => ({ type: 'idea', title, content, why, tags });
const link = (title: string, url: string, why: string, tags: string[]): Sample => ({ type: 'link', title, url, why, tags });

export const SAMPLE_POOL: Sample[] = [
  // ── 电影：动作 / 科幻 / 恐怖 / 动画 / 喜剧 / 西部 / 纪录 …
  film('七武士', '黑泽明', '1954', '雨里的最后一战，泥浆比刀光更有分量', ['日本', '武士', '群像', '雨']),
  film('疯狂的麦克斯：狂暴之路', 'George Miller', '2015', '两个小时只做一件事：往前开，再开回来', ['动作', '沙漠', '追逐', '改装车']),
  film('千与千寻', '宫崎骏', '2001', '海上的电车不报站，好像坐着就能长大', ['动画', '日本', '成长', '电车']),
  film('寄生虫', '奉俊昊', '2019', '楼梯一级一级往下，阶层就写在台阶上', ['韩国', '阶层', '黑色幽默', '楼梯']),
  film('黑客帝国', 'Lana & Lilly Wachowski', '1999', '红药丸还是蓝药丸，成了一代人的口头禅', ['科幻', '赛博朋克', '子弹时间', '选择']),
  film('闪灵', 'Stanley Kubrick', '1980', '三轮车压过地毯又压过木地板，声音一换就开始害怕', ['恐怖', '酒店', '对称', '声音']),
  film('无间道', '刘伟强 / 麦兆辉', '2002', '天台上两个人都想做回自己', ['香港', '警匪', '身份', '天台']),
  film('天使爱美丽', 'Jean-Pierre Jeunet', '2001', '把手伸进一袋豆子里的那种快乐', ['法国', '巴黎', '小确幸', '暖色']),
  film('上帝之城', 'Fernando Meirelles', '2002', '镜头跟着一只逃跑的鸡冲进枪战', ['巴西', '贫民窟', '手持镜头', '暴力']),
  film('三傻大闹宝莱坞', 'Rajkumar Hirani', '2009', '一边唱歌跳舞一边把教育制度骂了一遍', ['印度', '歌舞', '校园', '喜剧']),
  film('黄金三镖客', 'Sergio Leone', '1966', '墓地里三个人对峙，眼睛特写比枪还长', ['西部', '意大利', '对峙', '配乐']),
  film('摩登时代', 'Charles Chaplin', '1936', '人被卷进齿轮里，还在拧螺丝', ['默片', '工业', '喜剧', '机器']),
  film('机器人总动员', 'Andrew Stanton', '2008', '前四十分钟几乎没有台词，全靠一台垃圾机器人', ['动画', '皮克斯', '孤独', '环保']),
  film('一次别离', 'Asghar Farhadi', '2011', '没有坏人，每个人都只是在保护一点什么', ['伊朗', '家庭', '道德', '争吵']),
  film('蜘蛛侠：平行宇宙', 'Bob Persichetti / Peter Ramsey / Rodney Rothman', '2018', '把漫画网点和错版印刷做成了动画语言', ['动画', '超级英雄', '漫画', '嘻哈']),
  film('逃出绝命镇', 'Jordan Peele', '2017', '茶匙敲杯子的声音，从此听着发毛', ['恐怖', '种族', '催眠', '讽刺']),
  film('少林足球', '周星驰', '2001', '把武侠招式踢进足球场，荒诞又热血', ['香港', '喜剧', '足球', '无厘头']),
  film('地球脉动', 'BBC / David Attenborough', '2006', '雪豹在悬崖上追岩羊，比任何动作片都紧张', ['纪录片', '自然', '英国', '航拍']),
  film('霸王别姬', '陈凯歌', '1993', '「不疯魔不成活」，戏和人分不开了', ['京剧', '时代', '戏中戏', '执念']),
  // ── 音乐：流行 / 摇滚 / 嘻哈 / 爵士 / 古典 / 电子 / 乡村 / 雷鬼 / 非洲 / 拉美 / 华语 …
  music('Billie Jean', 'Michael Jackson', '1982', '前奏那段鼓机一响，脚就自己动了', ['流行', '贝斯线', '舞步', '美国']),
  music('Bohemian Rhapsody', 'Queen', '1975', '一首歌里塞进歌剧、民谣和硬摇滚', ['摇滚', '歌剧', '英国', '结构']),
  music('Smells Like Teen Spirit', 'Nirvana', '1991', '主歌小声副歌炸开，整个九十年代都在这个开关里', ['垃圾摇滚', '西雅图', '失真', '青春']),
  music('Juicy', 'The Notorious B.I.G.', '1994', '「It was all a dream」，把穷日子唱成了庆功宴', ['嘻哈', '纽约', '采样', '逆袭']),
  music('Alright', 'Kendrick Lamar', '2015', '街头游行里被喊成口号的一句副歌', ['嘻哈', '爵士', '抗议', '希望']),
  music('Dynamite', 'BTS', '2020', '迪斯科的铜管被 K-pop 擦得锃亮', ['K-pop', '韩国', '迪斯科', '明亮']),
  music('Water No Get Enemy', 'Fela Kuti', '1975', '铜管和鼓循环十分钟，越听越像在走路', ['Afrobeat', '尼日利亚', '律动', '铜管']),
  music('Garota de Ipanema', 'Antônio Carlos Jobim', '1962', '一个女孩走过海滩，旋律也跟着慢慢晃', ['波萨诺瓦', '巴西', '海边', '慵懒']),
  music('So What', 'Miles Davis', '1959', '两个和弦，留白比音符多', ['爵士', '调式', '小号', '冷静']),
  music('Master of Puppets', 'Metallica', '1986', '八分钟的速度金属中间突然安静下来', ['金属', '速度', '吉他', '失控']),
  music('月亮代表我的心', '邓丽君', '1977', '全世界华人 KTV 的最大公约数', ['华语', '老歌', '情歌', '温柔']),
  music('千千阙歌', '陈慧娴', '1989', '告别演唱会唱的歌，连离别都是金色的', ['粤语', '香港', '告别', '八十年代']),
  music('Clair de Lune', 'Claude Debussy', '1905', '钢琴像月光一样不着急', ['古典', '印象派', '钢琴', '夜']),
  music('One More Time', 'Daft Punk', '2000', '自动调音把人声变成了一种乐器', ['法式电子', '浩室', '机器人', '派对']),
  music('Jolene', 'Dolly Parton', '1973', '情歌里少见的示弱：求情敌别抢走他', ['乡村', '美国', '吉他', '恳求']),
  music('Redemption Song', 'Bob Marley', '1980', '只有一把木吉他，比整支乐队都有力', ['雷鬼', '牙买加', '自由', '原声']),
  music('Plastic Love', '竹内玛莉亚', '1984', '三十年后被算法推给全世界的城市流行', ['City Pop', '日本', '都市', '夜晚']),
  music('Dancing Queen', 'ABBA', '1976', '十七岁这个数字被唱成了永远', ['迪斯科', '瑞典', '舞池', '欢快']),
  music('一无所有', '崔健', '1986', '一块红布蒙住眼睛，中国摇滚从这里喊出来', ['摇滚', '北京', '呐喊', '唢呐']),
  music('Despacito', 'Luis Fonsi / Daddy Yankee', '2017', '听不懂西班牙语也能跟着哼', ['雷鬼顿', '波多黎各', '拉丁', '夏天']),
  music('Strobe', 'deadmau5', '2009', '前奏铺了快五分钟，等待本身就是高潮', ['电子', '渐进', '加拿大', '耐心']),
  // ── 图片（示例不带图，靠文字描述）
  image('神奈川冲浪里', '葛饰北斋', '1831', '巨浪像爪子一样扑向小船，远处富士山很小很稳', '最危险的瞬间和最安静的山放在同一张纸上', ['浮世绘', '日本', '海浪', '木版画']),
  image('星月夜', 'Vincent van Gogh', '1889', '夜空在打旋，柏树像火焰往上烧', '把失眠画成了天气', ['油画', '荷兰', '夜空', '漩涡']),
  image('地出', 'William Anders / 阿波罗 8 号', '1968', '月球地平线上升起半个蓝色地球', '第一次从外面看见家', ['太空', '摄影', '地球', '蓝色']),
  image('夜游者', 'Edward Hopper', '1942', '深夜餐馆的大玻璃窗里坐着几个互不说话的人', '城市里最亮的地方也最孤独', ['油画', '美国', '餐馆', '孤独']),
  image('呐喊', 'Edvard Munch', '1893', '桥上的人捂着耳朵，天空是血红的波纹', '焦虑终于有了一个形状', ['表现主义', '挪威', '焦虑', '红']),
  image('红黄蓝的构成', 'Piet Mondrian', '1930', '黑色粗线把白底切成格子，只填三块原色', '少到不能再少，却一眼认得出', ['抽象', '荷兰', '网格', '原色']),
  image('富春山居图', '黄公望', '1350', '一卷长长的山水，看的时候要边走边看', '时间被画成了长度', ['水墨', '元代', '长卷', '山水']),
  image('苏联公交车站', 'Christopher Herwig', '2015', '荒原上一个个造型古怪的混凝土候车亭', '最实用的小建筑被做成了雕塑', ['建筑', '摄影', '混凝土', '公路']),
  image('雨夜霓虹招牌', '', '', '积水里倒映着一块红色「理发」灯箱，被车灯搅碎', '倒影比招牌本身好看', ['随手拍', '雨', '霓虹', '倒影']),
  image('外婆家的旧挂历', '', '', '一九九几年的挂历，每页都是一位明星，背面被裁成了作业本封皮', '一张纸用了两辈子', ['随手拍', '家', '纸', '九十年代']),
  image('胜利之吻', 'Alfred Eisenstaedt', '1945', '时代广场上水兵弯腰亲吻一位穿白衣的护士', '一张照片替一整座城市松了口气', ['摄影', '纽约', '街头', '黑白']),
  // ── 摘抄
  text('一句摘抄', '世界上只有一种英雄主义，就是看清生活的真相之后依然热爱生活。', '罗曼·罗兰', '常被印在笔记本扉页，第二次读才觉得重', ['勇气', '生活']),
  text('一句摘抄', '我们都在阴沟里，但仍有人仰望星空。', 'Oscar Wilde', '一句话里同时有泥和光', ['星空', '处境']),
  text('一句摘抄', '人生如逆旅，我亦是行人。', '苏轼', '被贬的路上写得这么轻', ['宋词', '旅途', '豁达']),
  text('一句摘抄', 'Stay hungry, stay foolish.', 'Steve Jobs', '他自己说是从一本旧杂志的封底抄来的', ['演讲', '好奇']),
  text('一句摘抄', '凡是过去，皆为序章。', 'William Shakespeare', '把过去变成开头，而不是结局', ['时间', '戏剧']),
  text('一句摘抄', '多年以后，面对行刑队，奥雷里亚诺·布恩迪亚上校将会回想起父亲带他去见识冰块的那个遥远的下午。', '马尔克斯', '一个句子里同时站着过去、现在和将来', ['开头', '魔幻现实', '时间']),
  text('一句摘抄', '从前的日色变得慢，车，马，邮件都慢，一生只够爱一个人。', '木心', '慢被说成了一种奢侈', ['慢', '诗']),
  text('一句摘抄', '知其白，守其黑，为天下式。', '老子', '黑白不是对立，是一套用法', ['道德经', '黑白']),
  text('一句摘抄', 'The medium is the message.', 'Marshall McLuhan', '六十年前说的，放在短视频时代更准', ['媒介', '传播']),
  text('一句摘抄', '少年不识愁滋味，爱上层楼。', '辛弃疾', '年轻时的愁是为了写诗硬找的', ['宋词', '少年', '愁']),
  text('一句摘抄', '所有大人都曾经是小孩，虽然只有少数人记得。', 'Antoine de Saint-Exupéry', '写在献词里，比正文还先戳中人', ['童年', '记忆']),
  text('一句摘抄', 'Less is more.', 'Ludwig Mies van der Rohe', '三个词把一整代建筑说完了', ['建筑', '极简']),
  text('一句摘抄', 'Houston, we\'ve had a problem.', '阿波罗 13 号', '出了大事时最冷静的一句话', ['太空', '冷静', '危机']),
  text('一句摘抄', '生存还是毁灭，这是一个问题。', 'William Shakespeare', '被引用到变成梗，原句其实很绝望', ['戏剧', '犹豫']),
  // ── 想法
  idea('末班地铁上睡着的人', '整节车厢都在晃，他的头一点一点地找支点', '城市最累的样子', ['地铁', '深夜', '疲惫', '城市']),
  idea('把天气预报写成情书', '「明天午后有阵雨，记得带伞，也记得想我」', '最无聊的格式装最私人的话', ['天气', '情书', '格式', '反差']),
  idea('电梯里的十秒', '所有人都抬头盯着楼层数字，好像它会突然说话', '陌生人共处时的默契', ['电梯', '沉默', '陌生人']),
  idea('凌晨三点的便利店', '白光、关东煮的热气、店员在补货', '整条街唯一醒着的地方', ['便利店', '深夜', '白光', '热气']),
  idea('用外卖小票记日记', '每张小票就是一顿饭的时间和地点，贴在本子上就是一年', '最不起眼的纸记下最真实的生活', ['小票', '日记', '日常']),
  idea('只在下雨天开门的书店', '晴天关门，雨天点灯，门口放一桶别人留下的伞', '让坏天气变成一个约定', ['书店', '雨', '规则', '约定']),
  idea('游戏 NPC 的重复台词', '「你好，旅行者」听了一百遍，第一百零一遍突然有点感动', '重复也可以长出感情', ['游戏', '重复', 'NPC']),
  idea('楼下篮球场的拍球声', '每天早上六点半，比闹钟还准', '别人的习惯成了我的节拍器', ['篮球', '声音', '清晨', '节奏']),
  idea('爷爷没下完的象棋残局', '棋盘一直摆在阳台上，谁也不敢动', '没结束的东西最难收起来', ['象棋', '家', '未完成', '记忆']),
  idea('机场到达口的举牌人', '有人举着名字，有人举着一束花，有人什么都没举只是踮脚', '等待写在脸上的样子', ['机场', '等待', '重逢']),
  idea('把一首歌倒着放', '副歌变成吸气声，鼓点像有人在倒着走路', '熟悉的东西换个方向就陌生了', ['倒放', '声音', '实验']),
  idea('健身房的镜子墙', '每个人都在看镜子，但只看自己', '一屋子人各自孤独', ['健身房', '镜子', '自我']),
  idea('鱼摊电子秤的报价声', '「三斤二两，四十八块」，机械女声每天说几千遍', '最冷的声音在最热闹的地方', ['菜市场', '声音', '机器', '市井']),
  // ── 链接
  link('Radio Garden', 'https://radio.garden/', '转动地球，随手点开一个陌生城市的电台', ['电台', '地图', '声音', '全球']),
  link('The Pudding', 'https://pudding.cool/', '用可视化讲流行文化的小故事', ['数据', '可视化', '叙事']),
  link('巴别图书馆', 'https://libraryofbabel.info/', '博尔赫斯小说里的无限图书馆，真的被做出来了', ['博尔赫斯', '无限', '文字']),
  link('WindowSwap', 'https://www.window-swap.com/', '看一眼世界上别人家窗外的风景', ['窗户', '远方', '日常']),
  link('NASA 每日一天文图', 'https://apod.nasa.gov/apod/', '从 1995 年起每天一张宇宙照片', ['太空', '每日', '摄影']),
  link('Every Noise at Once', 'https://everynoise.com/', '几千种音乐流派铺成一张地图', ['音乐', '流派', '地图']),
  link('互联网档案馆 Wayback Machine', 'https://web.archive.org/', '看一个网站十年前长什么样', ['档案', '互联网', '怀旧']),
  link('Google 艺术与文化', 'https://artsandculture.google.com/', '在手机上放大看一幅名画的笔触', ['博物馆', '艺术', '高清']),
  link('neal.fun', 'https://neal.fun/', '一个人做的一堆好玩小网页', ['小游戏', '互联网', '好奇']),
  link('Atlas Obscura', 'https://www.atlasobscura.com/', '世界各地奇怪又真实的地方', ['旅行', '奇观', '地图']),
  link('东京公共厕所计划', 'https://tokyotoilet.jp/', '把最被忽视的空间当作建筑作品', ['城市', '公共空间', '建筑']),
];

/** 随机抽 n 条：先每种类型至少 1 条（库里有的话），再随机补满，最后打乱。不重复 */
export function drawSamples(n = 10, rand: () => number = Math.random, pool: Sample[] = SAMPLE_POOL): Sample[] {
  const left = pool.map((_, i) => i);
  const take = (idx: number) => left.splice(idx, 1)[0];
  const out: number[] = [];
  const types: ItemType[] = ['film', 'music', 'image', 'text', 'idea', 'link'];
  for (const t of types) {
    if (out.length >= n) break;
    const cand = left.map((i, k) => [i, k] as const).filter(([i]) => pool[i].type === t);
    if (cand.length) out.push(take(cand[Math.floor(rand() * cand.length)][1]));
  }
  while (out.length < n && left.length) out.push(take(Math.floor(rand() * left.length)));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.map((i) => ({ ...pool[i], tags: [...pool[i].tags], sample: 1 as const }));
}

/** 示例的「拾于」时间：铺在过去 3–90 天里，好让时间线 / 每日一穗一打开就有东西 */
export function sampleTimes(n: number, now = Date.now(), rand: () => number = Math.random): number[] {
  const DAY = 86400000;
  return Array.from({ length: n }, () => now - Math.round((3 + rand() * 87) * DAY + rand() * DAY * 0.5)).sort((a, b) => b - a);
}
