/**
 * 分类色板行（快速新建 / 分类管理共用，消除两处漂移实现）：
 * - 22 键预设色；底色走分类 HSL 变量公式（亮度档与徽章同源）；
 * - 命中目标 ≥24px + hover 描边反馈；选中态用 aria-pressed 表达（视觉 + 语义双通道）；
 * - 可访问名 = 本地化颜色名（color.* 键），title 保留原始键供进阶用户辨识；
 * - 可选「跟随愿望」尾部按钮：清空显式覆盖（分类管理用）。
 */
import { createElement, type ReactElement } from 'react'
import { categoryVars, CATEGORY_COLOR_KEYS } from '../../category-color.js'
import { useXyT, type XyKey } from '../i18n.js'

const COLOR_KEY_LABELS = Object.fromEntries(
  CATEGORY_COLOR_KEYS.map((key) => [key, `color.${key}` as XyKey]),
)

export function SwatchRow(props: {
  /** 当前选中键；null = 无选中。 */
  readonly picked: string | null
  readonly onPick: (key: string) => void
  /** 提供时在行尾渲染「跟随愿望」清除按钮。 */
  readonly followLabel?: string
  readonly onFollow?: () => void
  readonly busy?: boolean
}): ReactElement {
  const t = useXyT()
  return createElement('div', { className: 'xy-swatchrow', role: 'group', 'aria-label': t('quick.color') },
    ...CATEGORY_COLOR_KEYS.map((key) => {
      const picked = props.picked === key
      return createElement('button', {
        key,
        type: 'button',
        className: `xy-swatch${picked ? ' xy-picked' : ''}`,
        // busy 传导到色板本体：写操作在途时 22 格一并禁用——守卫吞掉的重入点击
        // 不再是无反馈的「点了没反应」（守卫语义对用户可见化）
        disabled: props.busy === true,
        style: {
          ...categoryVars(key, ''),
          background: 'hsl(var(--cat-h) calc(var(--cat-sbg, 58) * 1%) 52%)',
        },
        title: key,
        'aria-label': t(COLOR_KEY_LABELS[key]!),
        'aria-pressed': picked,
        onClick: () => props.onPick(key),
      })
    }),
    props.followLabel !== undefined && props.onFollow !== undefined
      ? createElement('button', {
          type: 'button',
          className: 'xy-btn',
          disabled: props.busy === true,
          onClick: props.onFollow,
        }, props.followLabel)
      : null)
}
