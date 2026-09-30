/**
 * 统一错误码 —— 与《开发配套-API接口字段契约.md》第 0 节一致
 * 0 成功 / 1xxx 参数 / 2xxx 鉴权 / 3xxx 业务状态 / 4xxx 资源不存在 / 5xxx 服务端
 */
export const ErrorCode = {
  OK: 0,

  // 1xxx 参数校验
  PARAM_ERROR: 1001,

  // 2xxx 鉴权权限
  UNAUTHORIZED: 2001,
  FORBIDDEN: 2002,

  // 3xxx 业务状态
  ACCOUNT_NOT_ACTIVE: 3001,   // 账号未激活，暂不可下单
  ORDER_STATUS_INVALID: 3002, // 订单当前状态不允许该操作
  STOCK_NOT_ENOUGH: 3003,     // 库存/可供量不足
  CHANGE_IN_PROGRESS: 3004,   // 存在进行中的变更申请
  PHONE_REGIST_TOO_OFTEN: 3005,
  LICENSE_DUPLICATED: 3006,   // 该营业执照已注册
  APPEAL_LIMIT: 3007,         // 30 天内仅可申诉 1 次
  PRODUCT_OFF_SHELF: 3008,    // 已下架商品不可发起变更
  PHONE_ALREADY_USED: 3009,   // 该手机号已被其他账号使用（撞 user.phone 唯一约束，2026-09-12 补）

  // 4xxx 资源不存在
  NOT_FOUND: 4001,

  // 5xxx 服务端
  INTERNAL_ERROR: 5001,
} as const

export const ErrorMessage: Record<number, string> = {
  [ErrorCode.OK]: 'ok',
  [ErrorCode.PARAM_ERROR]: '参数缺失或格式错误',
  [ErrorCode.UNAUTHORIZED]: '未登录或登录已失效',
  [ErrorCode.FORBIDDEN]: '当前身份无此权限',
  [ErrorCode.ACCOUNT_NOT_ACTIVE]: '账号未激活，暂不可下单',
  [ErrorCode.ORDER_STATUS_INVALID]: '订单当前状态不允许该操作',
  [ErrorCode.STOCK_NOT_ENOUGH]: '可供量不足',
  [ErrorCode.CHANGE_IN_PROGRESS]: '该商品存在进行中的变更申请',
  [ErrorCode.PHONE_REGIST_TOO_OFTEN]: '该手机号近期已注册多次',
  [ErrorCode.LICENSE_DUPLICATED]: '该营业执照已注册，连锁分店请联系运营走授权流程',
  [ErrorCode.APPEAL_LIMIT]: '30 天内仅可申诉 1 次',
  [ErrorCode.PRODUCT_OFF_SHELF]: '已下架商品不可发起变更',
  [ErrorCode.PHONE_ALREADY_USED]: '该手机号已被其他账号使用',
  [ErrorCode.NOT_FOUND]: '资源不存在',
  [ErrorCode.INTERNAL_ERROR]: '服务异常，请稍后重试',
}

/** 业务异常：直接抛，由全局过滤器转成 { code, msg } */
export class BizException extends Error {
  constructor(public readonly code: number, msg?: string) {
    super(msg || ErrorMessage[code] || '业务异常')
  }
}

/** 采购方账号状态（主计划 4.1） */
export const AccountStatus = {
  PENDING: 1,        // 待审核
  ACTIVE: 2,         // 正常
  REJECTED: 3,       // 已驳回（可申诉）
  REJECTED_FINAL: 4, // 终态驳回（60 天冻结）
  SUSPENDED: 5,      // 运营停用
  /// 卡AC（2026-09-30）：已注销（**采购方本人自助注销**，与 5「运营停用」是两回事）
  /// 两者在前端提示文案与后台筛选里必须是不同状态 —— 5 是运营处置、可恢复；6 是本人注销、不可恢复。
  /// ⚠️ 维持 6 的语义不再另造值：运营停用页(account-suspended.vue)只认 5，注销页只认 6。
  CANCELLED: 6,
} as const

/** 订单状态机（《开发配套①》第二节） */
export const OrderStatus = {
  PENDING_CONFIRM: 10, // 待确认（下单后，未拆单）
  SPLITTED: 20,        // 已拆单（决策1：核单时拆）
  STOCKING: 30,        // 备货中（拆单后默认满额，供应商备货）
  WAIT_DELIVERY: 40,   // 待配送（供应商确认备货完成后直接进入，不再单独验收称重）
  ASSIGNED: 45,        // 已派单（已指派配送员，待取货）
  DELIVERING: 50,      // 配送中
  DELIVERED: 60,       // 已送达
  COMPLETED: 70,       // 已完成（采购方逐项确认）
  SETTLED: 90,         // 已结算
  CANCELLED: 91,       // 已取消
  UNDELIVERABLE: 92,   // 无法交付（配送员上报异常，订单归类到无法交付列表）
} as const

/** 角色 */
export const Role = {
  PURCHASER: 'purchaser',
  SUPPLIER: 'supplier',
  COURIER: 'courier',
  ADMIN: 'admin',
  BUSINESS_AGENT: 'business_agent', // 决策5：业务员 = 运营子账号
} as const
