import { IsInt, IsOptional, IsString, IsNumber, IsArray, IsIn, MaxLength, Min } from 'class-validator'

/// 采购方售后申请（主计划 4.5，决策3：拒收差额可主动发起售后）
///
/// ⚠️ 卡AE（2026-09-30）改了三处，别按老版本理解：
///   ① `orderItemId` 由「选填」改为**必填**（口径 6c：必须选到具体商品）
///   ② `qtyDiff` 由「选填」改为**必填** —— 它就是客户填报的「涉及数量」，
///      上限由服务端按该明细的收货数量兜（上限要读库，不在这里写死）
///   ③ `amountDiff` **从 DTO 移除**：差异金额一律由服务端按 `qtyDiff × salePrice` 算，
///      不接受客户端传值（whitelist:true 会把老包多传的该字段静默剥掉，不会报错）
export class AftersaleDto {
  /// ⚠️ 卡AE 起服务端**不再从这个字段取订单号**（一律按 orderItemId 反查明细所属订单），
  /// 保留声明只为兼容既有调用方与老版本小程序包；缺省也不影响业务
  @IsOptional()
  @IsInt({ message: 'orderId 必须为整数' })
  orderId?: number

  /// 具体商品（订单明细）—— 必填；必须是本采购方订单下的明细，否则参数错
  @IsInt({ message: '请选择订单中的具体商品' })
  orderItemId: number

  /// 1 少货 / 2 品质问题 / 3 错货 / 4 其他
  @IsIn([1, 2, 3, 4], { message: 'type 只能为 1(少货)/2(品质)/3(错货)/4(其他)' })
  type: number

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string

  /// 涉及数量（客户填报）—— 必填；服务端另校验 >0 且 ≤ 该明细收货数量
  @IsNumber({}, { message: '请填写涉及数量' })
  @Min(0)
  qtyDiff: number

  /// 申请照片 URL 数组（2026-09-19 决策⑦：售后拍照留证）。
  /// ⚠️ 组装上可选（不传即无照片），但**品质问题（type=2）时必须非空** —— 这条由服务端真校验。
  /// 存 URL（/uploads/xxx），绝不收 base64。
  /// 校验白名单：本字段必须在此声明，否则 whitelist:true 会把它剥掉
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[]
}
