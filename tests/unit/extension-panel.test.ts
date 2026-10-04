import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configurePanel } from '../../extensions/shared/panel'

afterEach(() => { vi.unstubAllGlobals() })

describe('native capture sidebars', () => {
  it('opens Chrome side panel on the toolbar action, with no popup stealing the click', async () => {
    const setPanelBehavior = vi.fn(async () => {})
    vi.stubGlobal('chrome', { sidePanel: { setPanelBehavior } })
    configurePanel()
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true })
    const manifest = JSON.parse(readFileSync('extensions/chrome/manifest.json', 'utf8'))
    expect(manifest.side_panel.default_path).toBe('panel.html')
    expect(manifest.permissions).toContain('sidePanel')
    expect(manifest.action.default_popup).toBeUndefined()
    expect(manifest.host_permissions).toContain('https://app.outlio.io/*')
    expect(manifest.content_scripts[1].matches).toEqual(['https://app.outlio.io/extension/connect*'])
  })
  it('opens Firefox sidebar synchronously from its toolbar gesture', () => {
    let clicked!: () => void
    const open = vi.fn(async () => {})
    vi.stubGlobal('chrome', { sidebarAction: { open }, action: { onClicked: { addListener: (fn: () => void) => { clicked = fn } } } })
    configurePanel(); clicked()
    expect(open).toHaveBeenCalledOnce()
    const manifest = JSON.parse(readFileSync('extensions/firefox/manifest.json', 'utf8'))
    expect(manifest.sidebar_action.default_panel).toBe('panel.html')
    expect(manifest.action.default_popup).toBeUndefined()
    expect(manifest.permissions).not.toContain('sidePanel')
  })
  it('retains an operable popup when sidebars are unavailable', () => {
    const setPopup = vi.fn(async () => {})
    vi.stubGlobal('chrome', { action: { setPopup } })
    configurePanel()
    expect(setPopup).toHaveBeenCalledWith({ popup: 'popup.html' })
  })
  it('falls back when native panel initialization fails', async () => {
    const setPopup = vi.fn(async () => {})
    vi.stubGlobal('chrome', { action: { setPopup }, sidePanel: { setPanelBehavior: vi.fn(async () => { throw new Error('unsupported') }) } })
    configurePanel()
    await vi.waitFor(() => expect(setPopup).toHaveBeenCalledWith({ popup: 'popup.html' }))
  })
})
