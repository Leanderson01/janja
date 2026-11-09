import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useVoice } from '@/state/voice-context'

type DeviceKind = 'audioinput' | 'audiooutput'

// Setinha ao lado do botão de microfone/fone: lista os dispositivos do tipo e
// troca ao selecionar. A lista é lida ao ABRIR (um fone plugado depois aparece).
// Antes da permissão de microfone os rótulos vêm vazios: vira `Dispositivo N`.
export function DeviceMenu({
  kind,
  children
}: {
  kind: DeviceKind
  /** O gatilho (a setinha), um único elemento. */
  children: ReactNode
}): React.JSX.Element {
  const { inputDeviceId, outputDeviceId, selectDevice } = useVoice()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  const current = (kind === 'audioinput' ? inputDeviceId : outputDeviceId) ?? 'default'

  async function loadDevices(open: boolean): Promise<void> {
    if (!open) return
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((d) => d.kind === kind))
    } catch {
      setDevices([])
    }
  }

  async function handleSelect(deviceId: string): Promise<void> {
    try {
      await selectDevice(kind, deviceId)
    } catch {
      toast.error('Não deu para trocar o dispositivo')
    }
  }

  return (
    <DropdownMenu onOpenChange={(open) => void loadDevices(open)}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuRadioGroup value={current} onValueChange={(id) => void handleSelect(id)}>
          {devices.map((device, i) => (
            <DropdownMenuRadioItem key={device.deviceId || i} value={device.deviceId}>
              <span className="truncate">{device.label || `Dispositivo ${i + 1}`}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
