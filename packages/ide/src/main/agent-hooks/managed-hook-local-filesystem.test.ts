import {     rm,  } from 'node:fs/promises'
import { } from 'node:os'
import { } from 'node:path'
import { afterEach, describe,  } from 'vitest'
import { } from './managed-hook-local-filesystem'

const tempHomes: string[] = []

afterEach(async () => {
  await Promise.all(tempHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe('managed-hook local filesystem', () => {

})
