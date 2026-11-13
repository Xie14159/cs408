'use client'

import * as React from 'react'
import { autoSnapshot } from '@/components/backup-card'

export function SnapshotBoot() {
  React.useEffect(() => {
    autoSnapshot()
  }, [])
  return null
}
