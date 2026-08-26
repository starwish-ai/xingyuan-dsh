/** client 半侧共享的会话事件状态形状（卡片 Definition 与渲染组件共用）。 */
import type {
  XingyuanChartEventData,
  XingyuanCheckinEventData,
  XingyuanMicroEventData,
  XingyuanTaskEventData,
  XingyuanWishEventData,
} from '../events.js'

export type AnyXyEvent =
  | XingyuanWishEventData
  | XingyuanTaskEventData
  | XingyuanCheckinEventData
  | XingyuanChartEventData
  | XingyuanMicroEventData

/** whole-value 单事件卡片状态：每条事件独立成卡，id=event.seq。 */
export interface XyState {
  readonly type: string
  readonly seq: number
  readonly data: AnyXyEvent
}
