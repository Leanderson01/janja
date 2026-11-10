// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InputSensitivity } from './InputSensitivity'
import { VadLevelMeter } from './VadLevelMeter'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function slot(container: HTMLElement, name: string): HTMLElement | null {
  return container.querySelector(`[data-slot="${name}"]`)
}

describe('VadLevelMeter', () => {
  it('na escala do slider: abaixo do limiar âmbar, acima verde, marca no limiar', () => {
    // Nível −30 dB (70%), limiar −50 dB (50%): 50% âmbar + 20% verde.
    const { container } = render(<VadLevelMeter levelDb={-30} thresholdDb={-50} />)

    const below = slot(container, 'vad-level-below')
    const above = slot(container, 'vad-level-above')
    const mark = slot(container, 'vad-level-threshold')

    expect(below?.className).toContain('bg-warning')
    expect(below?.style.width).toBe('50%')
    expect(above?.className).toContain('bg-success')
    expect(above?.style.left).toBe('50%')
    expect(above?.style.width).toBe('20%')
    expect(mark?.style.left).toBe('50%')
  })

  it('abaixo do limiar: nada verde', () => {
    const { container } = render(<VadLevelMeter levelDb={-70} thresholdDb={-50} />)

    expect(slot(container, 'vad-level-below')?.style.width).toBe('30%')
    expect(slot(container, 'vad-level-above')?.style.width).toBe('0%')
  })

  it('sem limiar conhecido (automático antes da 1ª leitura): sem marca e sem verde', () => {
    const { container } = render(<VadLevelMeter levelDb={-40} thresholdDb={null} />)

    expect(slot(container, 'vad-level-threshold')).toBeNull()
    expect(slot(container, 'vad-level-above')).toBeNull()
  })

  it('expõe o nível em dB para leitor de tela', () => {
    const { container } = render(<VadLevelMeter levelDb={-42.4} thresholdDb={-50} />)

    const meter = slot(container, 'vad-level-meter')
    expect(meter?.getAttribute('aria-valuenow')).toBe('-42')
    expect(meter?.getAttribute('aria-valuetext')).toBe('−42 dB')
  })
})

describe('InputSensitivity', () => {
  const reading = { levelDb: -40, thresholdDb: -58 }

  it('automático (padrão): interruptor ligado, SEM slider, marca no limiar calculado', () => {
    const { container } = render(
      <InputSensitivity
        autoSensitivity
        thresholdDb={-50}
        reading={reading}
        onAutoSensitivityChange={() => {}}
        onThresholdChange={() => {}}
      />
    )

    expect(screen.getByText('Sensibilidade de entrada')).toBeTruthy()
    const toggle = screen.getByRole('switch', {
      name: 'Determinar automaticamente a sensibilidade'
    })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('slider')).toBeNull()
    // −58 dB => 42% da barra, e o valor calculado aparece ao lado.
    expect(slot(container, 'vad-level-threshold')?.style.left).toBe('42%')
    expect(slot(container, 'input-sensitivity-auto-value')?.textContent).toBe('−58 dB')
  })

  it('desligar o automático chama o callback com false', async () => {
    const onAutoSensitivityChange = vi.fn()
    render(
      <InputSensitivity
        autoSensitivity
        thresholdDb={-50}
        reading={reading}
        onAutoSensitivityChange={onAutoSensitivityChange}
        onThresholdChange={() => {}}
      />
    )

    await userEvent.click(
      screen.getByRole('switch', { name: 'Determinar automaticamente a sensibilidade' })
    )

    expect(onAutoSensitivityChange).toHaveBeenCalledWith(false)
  })

  it('manual: slider em dB de −100 a 0 com o valor rotulado, marca no valor do slider', () => {
    const { container } = render(
      <InputSensitivity
        autoSensitivity={false}
        thresholdDb={-50}
        reading={reading}
        onAutoSensitivityChange={() => {}}
        onThresholdChange={() => {}}
      />
    )

    const slider = screen.getByRole('slider', { name: 'Limiar de sensibilidade de entrada' })
    expect(slider.getAttribute('aria-valuemin')).toBe('-100')
    expect(slider.getAttribute('aria-valuemax')).toBe('0')
    expect(slider.getAttribute('aria-valuenow')).toBe('-50')
    expect(slot(container, 'input-sensitivity-value')?.textContent).toBe('−50 dB')
    // No manual a marca segue o SLIDER, não o limiar da leitura.
    expect(slot(container, 'vad-level-threshold')?.style.left).toBe('50%')
  })

  it('manual: seta para a direita sobe 1 dB', async () => {
    const onThresholdChange = vi.fn()
    render(
      <InputSensitivity
        autoSensitivity={false}
        thresholdDb={-50}
        reading={null}
        onAutoSensitivityChange={() => {}}
        onThresholdChange={onThresholdChange}
      />
    )

    screen.getByRole('slider').focus()
    await userEvent.keyboard('{ArrowRight}')

    expect(onThresholdChange).toHaveBeenCalledWith(-49)
  })

  it('desabilitado (push-to-talk): interruptor e slider travados', () => {
    render(
      <InputSensitivity
        autoSensitivity={false}
        thresholdDb={-50}
        reading={null}
        disabled
        onAutoSensitivityChange={() => {}}
        onThresholdChange={() => {}}
      />
    )

    expect(screen.getByRole('switch').hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('slider').hasAttribute('data-disabled')).toBe(true)
  })
})
