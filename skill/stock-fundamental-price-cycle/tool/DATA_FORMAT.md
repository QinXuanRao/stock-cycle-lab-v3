# 数据合同 / schema_version 3

两条等价输入路径：

- 一个bundle.json，包含以下全部结构；
- metadata.json、securities.csv、financials.csv、prices.csv、benchmarks.csv、calendar.csv六文件。文件名必须精确一致，UTF-8编码；CSV支持BOM、引号、换行和转义双引号。

examples/synthetic-input.json与examples/csv提供完整合成样例。所有值只是测试，不是实时数据。输入目录可来自任意数据商导出后的规范化结果，不能直接假定兼容某个平台原始字段。

## 顶层与股票池

~~~json
{
  "schema_version": 3,
  "demo": false,
  "as_of": "2026-09-03T22:00:00Z",
  "universe": {
    "label": "本次股票池名称",
    "scope": "provided",
    "expected_count": 2,
    "coverage_verified": true,
    "missing_partitions": [],
    "snapshot_at": "2026-09-03T21:00:00Z",
    "source": "证券主表/成分记录出处"
  },
  "markets": {},
  "stocks": []
}
~~~

scope为provided或full_market。expected_count未知用null；漏取证券不能从预期数中删掉。全市场覆盖须有来源、截至日期有效的快照、核验声明、预期数一致且无失败分区。as_of必须带时区，不用电脑日期替代交易所交易日。

## 市场数据（markets.CN / markets.US）

- calendar_source：交易日历来源；calendar_verified_through：已验证至哪个市场本地日期。
- calendar：升序的{date,close_at}。close_at含时区，逐日提供真实收盘时间，包括夏令时、节假日和提前收盘。允许未来日历条目，程序只选择已收盘交易日。
- benchmark：id、source、return_basis="total_return"、bars=[{date,close}]。基准由用户选，不绑定中证500/标普500；它必须代表股票池，且至少有技术参数要求的历史。比较个股和基准的相同起止交易日。

股票和基准须有一致可解释的总回报价格口径。默认只给split_dividend_adjusted个股与total_return基准完整资格；split_adjusted-only可观察，但不冒充已核实的总回报相对强弱。

## 逐股证券与状态（stocks[] / securities.csv）

JSON中的嵌套结构见合成样例。CSV按以下头部展开：

~~~text
market,ticker,name,name_source,instrument_type,currency,cap_basis,cap_value,quote_date,quote_published_at,quote_source,financials_verified,price_source,adjustment_basis,adjustment_anchor_at,adjustment_verified,status_date,status_source,status_verified,listing_sessions,halted,is_st,locked_limit_count20
~~~

- market为CN/US；ticker为字符串，CN保留六位前导零，US允许点/横线，例如BRK.B。市场+代码唯一，名字使用源中名称。
- instrument_type为common_stock或adr；基金/ETF没有同样公司利润含义，保留在结果但阻断完整资格，不静默剔除。
- currency为CNY/USD报价币种；cap_value单位为基础元/美元，不是亿/百万。
- cap_basis：CN必须circulating_a_share；US须与用户配置public_float或total_market_cap一致。
- quote_date必须等于该市场已完成交易日；quote_published_at<=as_of；quote_source记录出处。
- financials_verified声明所供财报包括截至时点最新报告及计算所需版本，必须经数据源校验。
- price_source记录行情来源。adjustment_basis为split_dividend_adjusted或split_adjusted；adjustment_anchor_at不能晚于as_of；adjustment_verified对应point_in_time_verified。
- status_date等于已完成交易日，status_verified=true且有status_source。listing_sessions是自上市至观察日的交易所交易日数，不是随意截取的K线条数。
- halted为布尔。CN另需is_st及近20交易日locked_limit_count20；必须用当日实际涨跌停规则/可信状态字段，不能统一套9.5%。US这两项不适用，留空/null。

JSON中adjustment={basis,anchor_at,point_in_time_verified}；status={date,source,verified,listing_sessions,halted,is_st,locked_limit_count20}。

## 财报（stocks[].financials / financials.csv）

~~~text
market,ticker,fiscal_year,quarter,period_end,published_at,net_income_ytd,profit_basis,eps_ytd,currency,eps_basis,share_basis_id,eps_comparable,point_in_time_verified,source
~~~

fiscal_year是财年标识，不必等于自然年；quarter为财年1–4，period_end为实际截止日期。net_income_ytd为财年累计归属净利润；CN profit_basis=attributable_to_parent，US=attributable_to_common。不要以营业利润/合并净利润替代。金额为财报币种基础单位，计算分子分母币种须一致；财报币种可与股票报价币种不同，盈利增长率不做隐式换汇。

eps_basis="basic"，eps_ytd为累计基本EPS。share_basis_id标识同一拆股/重述后的每股可比口径；eps_comparable和point_in_time_verified为布尔。EPS TTM采用年度+本期累计-上年同期累计的可比口径代理，不宣称精确重建会计准则下TTM加权分母。

每个计算所需报告都有含时区published_at及source。程序使用as_of前最近可得版本，排除未来报告；不能把报告期末当公告时间。缺公告时间的组件不会参与运算。同一财年/季度/公告时间有冲突数据会阻断。

## 日线（stocks[].bars / prices.csv）

~~~text
market,ticker,date,open,high,low,close,volume,amount
~~~

OHLC为一致复权价格，volume为可比股数，amount为当日真实成交额、报价币种基础单位。按date升序、无重复。必须覆盖数据起点至已完成交易日的全部交易所交易日；停牌日如提供carry-forward OHLC，量和成交额为0，不能删停牌日抬高均量。至少120根，并建议250根以上以重建前置状态；不完整序列为unknown。

benchmark CSV头部为market,date,close。calendar CSV头部为market,date,close_at。CSV里的空白表示null，布尔只接受true/false，数值不带%、千分逗号或单位。JSON不接受NaN、Infinity或原型污染键。

## 输出

results.json保留运行清单与逐股完整结果、基本面组件、最新谓词、数值证据和前向状态账本。CSV是摘要；文本公式前缀已作防护，避免直接触发表格公式。

manifest记录版本、三个筛选层、覆盖率、各市场行情日/基准/币种、配置及SHA256。哈希证明输入/版本是否相同，不证明数据商数据真实。数据仍需来源校验。
