// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const selectDevice = vi.fn(async () => {})
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/state/voice-context', () => ({
  useVoice: () => ({ inputDeviceId: 'mic-1', outputDeviceId: null, selectDevice })
}))

import { DeviceMenu } from './DeviceMenu'
import { DeviceChevron } from './VoiceControlBar'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DeviceMenu', () => {
  it('abre pela setinha, lista os dispositivos e troca ao selecionar', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn(async () => [
          { kind: 'audioinput', deviceId: 'mic-1', label: 'Microfone USB' },
          { kind: 'audioinput', deviceId: 'mic-2', label: '' },
          { kind: 'audiooutput', deviceId: 'out-1', label: 'Caixas' }
        ])
      }
    })
    render(
      <DeviceMenu kind="audioinput">
        <DeviceChevron label="Dispositivo de entrada" />
      </DeviceMenu>
    )
    const trigger = screen.getByRole('button', { name: 'Dispositivo de entrada' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')

    const first = await screen.findByRole('menuitemradio', { name: 'Microfone USB' })
    expect(first.getAttribute('aria-checked')).toBe('true')
    const second = screen.getByRole('menuitemradio', { name: 'Dispositivo 2' })
    expect(screen.queryByRole('menuitemradio', { name: 'Caixas' })).toBeNull()

    await userEvent.click(second)
    await waitFor(() => expect(selectDevice).toHaveBeenCalledWith('audioinput', 'mic-2'))
  })
})
