# 模型合同 v3.0.0

## 范围与来源

通用股票评估模型，CN/US为市场配置，自选股/商品股只属于测试输入。公司基本面门槛来自前期视频蒸馏：单季净利润同比>30%、EPS>0；A股流通市值50–500亿元。六类价格周期来自Oliver Kell框架，以下数值化细节是研究实现，不声称原作者精确规则，也没有盈利验证。

默认参数的可执行唯一来源是engine.js的DEFAULTS。DEFAULTS不包含证券名单或分析日期。US市值与成交额门槛为null，按本次用户要求独立填写美元值，不转换人民币。默认US public_float口径需用户确认；total_market_cap只能显式作为新配置。所有改动必须有overrides中的path、old、value、reason和provenance=user-specified。

框架来源：

- https://kelltrading.com/
- https://traderlion.com/technical-analysis/chart-patterns/cycle-of-price-action-by-oliver-kell/

市场差异核验：

- https://www.nyse.com/trade/hours-calendars ：美东时区、正式交易时段与提前收盘日；不把固定UTC时刻写入算法。
- https://english.sse.com.cn/start/trading/schedule/ ：A股交易日安排；实际日历由输入提供并核验。
- https://www.sec.gov/data-research/structured-data/2507-dqreminder-public-float-tagging-errors ：SEC public float有特定观察日，且可能有标度或日期标注错误；不能拿年报历史值冒充当前市值。

## 三层判定

1. 基本面：单季度利润同比、EPS TTM、市值范围，加上时点/来源/口径核验。
2. 可交易性：日均成交额、上市时间、暂停交易；CN另核验ST和持续一字涨跌停。数据不足为unknown。
3. 完整策略资格：前两层pass，匹配基准uptrend，当根确认Wedge Pop/EMA Crossback/Base n' Break，无更高优先级未知风险，前置状态未冲突，触发位>失效位>0，复权/相对回报口径有证据。

股票池覆盖不足不使已取得股票的个别信号失效，但不得称得到全市场完整名单。市场/行业与个股状态不混为一谈。reduce/exit是模型风险分类，不自动执行交易。

## 数值计算

- EMA10/20：首个收盘价种子，alpha=2/(N+1)递推，至少120根暖机。
- TR=max(H-L,abs(H-前C),abs(L-前C))；ATR14首14个TR均值起始，之后Wilder递推。
- 信号量比基线取信号日前20日，排除信号日；流动性均额取截至信号日含当天20个交易所交易日。
- 20日相对强弱=同起止日期个股总回报-基准总回报。数据错位或缺基准不填0。
- 上升市场：近5日中至少3日C>EMA20且EMA10>EMA20，EMA20不低于5日前。下降条件相反。近20日穿越EMA20>=3次且均线间距中位数<=0.5%时，震荡标签优先。
- Q1单季=累计；Q2/3/4单季=本期累计-上一季度累计。同比=(本期单季-上年同季)/abs(上年同季)*100，零分母unknown；负基数/扭亏单列提示，不新增“本季必须正盈利”门槛。
- EPS TTM：年度值+本年最新累计-上年同季累计；若最新为年报，直接年度值。每股口径/货币/公告组件不齐则unknown。

## 前向价格状态机

所有平台/枢轴排除信号日。每根K线仅使用当时可知数据；状态历史自动重建，不接受助手直接输入形态true/false。保存当日事件与活动周期两个字段；Neutral表示没有新事件，不意味着趋势横盘。

必要谓词：

- Reversal Extension：此前20日价格下跌、EMA20下降；L低于EMA10至少2ATR；量比>=1.5；触及前60日低点和前12个已完成周低点附近（0.5ATR容差）；阳线且收盘位于日内上半区。
- Wedge Pop：之前有未被Wedge Drop打断的Reversal，或满足可量化筑底代理（前60日下跌、前10日幅度<=15%、后半最低价不低于前半）；前5日TR中位数/再前5日<=0.8；均线差/C<=1%；C突破两EMA及前5日高点；量比>=1.2；RS20>0。
- EMA Crossback：有效Wedge Pop后2–15交易日，首次完整回踩确认；L落在均线带上下0.5ATR；回调均量小于Wedge Pop量；C在均线带上方，且阳线高于前收盘或突破前高。
- Base n' Break：按5至20日升序寻找第一个完整平台，不跨窗口拼证据。平台之前已处于上升状态，当日仍在支持均线上；宽度<=15%且<=6ATR；后半最低价不低于前半；平台均量小于之前等长窗口；收盘突破平台高点且量比>=1.2。6ATR是v3对原“与ATR相容”的显式研究量化，不是视频原值。
- Exhaustion Extension：前置Wedge Pop或Base未被Wedge Drop打断；C高于EMA10>=2ATR，量比>=1.5。不当成买点。
- Wedge Drop：C低于EMA20和前5日低点，量比>=1.2；或先前记录的结构失效位被收盘跌破，后者无需量能确认。

优先级：结构止损/Wedge Drop > Exhaustion Extension > Base n' Break > EMA Crossback > Wedge Pop > Reversal Extension。任一确定false否决形态；无false但有未知只能candidate。多个形态同时成立保留副谓词，但主状态唯一。

事件为Neutral时活动周期延续，入场资格不延续。Exhaustion仅由新确认Base或Wedge Drop解除；Wedge Drop之后不能直接把EMA Crossback/Base作为正常延续。结构失效位在入场/延续事件时建立，只上移不放宽，Wedge Drop后清除。未有实际持仓，仍只输出风险标签。

## 与v2的关系

v2是助手计算谓词后调用门控器；v3从原始财报与OHLCV直接计算，并固定筑底、周线支撑和平台ATR代理，因此二者不保证同结果。日期、缓存、股票名单都不带入默认配置。UI、Worker、CLI使用同一engine.js；参数/数据改变应改变指纹。

不包括实际回测、成本、仓位、T+1/结算可卖数量、排队成交或空头交易模拟。下单和风险暴露决策仍在工具能力之外。
