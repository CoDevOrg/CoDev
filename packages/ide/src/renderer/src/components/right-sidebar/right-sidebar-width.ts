export const RIGHT_SIDEBAR_MIN_WIDTH = 220
export const RIGHT_SIDEBAR_MIN_NON_SIDEBAR_AREA = 320
export const RIGHT_SIDEBAR_ABSOLUTE_FALLBACK_MAX_WIDTH = 2000

export function computeMaxRightSidebarPanelWidth(
  windowWidth: number | null | undefined,
  renderedExtraWidth: number
): number {
  if (typeof windowWidth !== 'number' || !Number.isFinite(windowWidth)) {
    return RIGHT_SIDEBAR_ABSOLUTE_FALLBACK_MAX_WIDTH
  }

  return Math.max(
    RIGHT_SIDEBAR_MIN_WIDTH,
    windowWidth - RIGHT_SIDEBAR_MIN_NON_SIDEBAR_AREA - renderedExtraWidth
  )
}

/** CoDev: the chat is the product, so this panel never grows wider than the center beside it. */
export function computeCodevMaxRightSidebarPanelWidth(
  windowWidth: number | null | undefined,
  renderedExtraWidth: number,
  leftSidebarWidth: number
): number {
  const stockMax = computeMaxRightSidebarPanelWidth(windowWidth, renderedExtraWidth)
  if (typeof windowWidth !== 'number' || !Number.isFinite(windowWidth)) {
    return stockMax
  }
  const halfOfRemaining = Math.floor((windowWidth - leftSidebarWidth - renderedExtraWidth) / 2)
  return Math.min(stockMax, Math.max(RIGHT_SIDEBAR_MIN_WIDTH, halfOfRemaining))
}

export function clampRightSidebarPanelWidth(
  width: number,
  windowWidth: number | null | undefined,
  renderedExtraWidth: number
): number {
  return Math.min(
    computeMaxRightSidebarPanelWidth(windowWidth, renderedExtraWidth),
    Math.max(RIGHT_SIDEBAR_MIN_WIDTH, width)
  )
}
