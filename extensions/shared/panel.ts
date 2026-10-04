/** Browser-owned panels: no iframe or controls injected into LinkedIn. */
declare const chrome: {
  sidePanel?: { setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void> }
  sidebarAction?: { open(): Promise<void> }
  action: {
    onClicked: { addListener(listener: () => void): void }
    setPopup(options: { popup: string }): Promise<void>
  }
}

export function configurePanel(): void {
  if (chrome.sidePanel) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => chrome.action.setPopup({ popup: 'popup.html' }))
  } else if (chrome.sidebarAction) {
    chrome.action.onClicked.addListener(() => {
      // Must happen directly in the user-gesture handler, before any await.
      void chrome.sidebarAction!.open().catch(() => chrome.action.setPopup({ popup: 'popup.html' }))
    })
  } else {
    void chrome.action.setPopup({ popup: 'popup.html' })
  }
}
