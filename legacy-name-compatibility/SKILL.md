---
name: a-share-fundamental-price-cycle
description: 旧名称兼容入口。使用跨市场基本面与价格周期工具评估A股或美股，支持任意股票池和完整市场；转入stock-fundamental-price-cycle，不受名称中的A股或历史测试行业限制。
metadata:
  model-version: "3.0.0"
---

# 旧名称兼容入口

用户已明确：自选股和商品股只是测试样本，能力范围不应被它们限制。本技能已升级为跨市场独立工具。

立即完整读取同级[stock-fundamental-price-cycle/SKILL.md](../stock-fundamental-price-cycle/SKILL.md)，按其中路由读取模型和数据合同，再调用它自带的独立工具。支持任意有充分数据的A股/美股股票池；美股是独立美元参数，不自动换汇。

不要调用本目录保留的v2 decision_gate.py或把旧名单当作新模型结果。那些文件仅为保留旧工作记录；新模型、程序和可移植HTML在同级stock-fundamental-price-cycle/tool内。

若同级技能未安装，明确说明缺少新版工具，请用户安装Stock Cycle Lab v3包；不要静默退回v2范围或假装已经执行新版。
