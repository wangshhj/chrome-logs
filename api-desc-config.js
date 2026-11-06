// 接口描述配置（按顺序匹配，先命中先返回）
// 可按需继续追加规则：{ key: '接口关键字', desc: '中文描述' }
const API_DESC_RULES = [
  { key: '/action/Add', desc: '新建' },
  { key: '/Add', desc: '新建' },
  { key: 'batchCalculate', desc: '计算' },
  { key: 'get_real_price', desc: '取价' },
  { key: 'list_last_product', desc: '历史明细报价' },
  { key: '/TriggerEvent', desc: 'UI事件' },
  { key: '/action/Edit', desc: '编辑' },
  { key: '/edit', desc: '编辑' },
  { key: 'price_policy/service/match', desc: '价格策略匹配' },
  { key: '/action/Clone', desc: '复制' },
  { key: '/QuoteObj/controller/List', desc: '历史报价' },
  { key: '/SalesOrderProductObj/controller/HistoryList', desc: '历史订单' },
  { key: '/mutipleUnit/service/calc', desc: '多单位计算' },
  { key: '/batch_query_bom_price', desc: 'BOM计算' },
];

