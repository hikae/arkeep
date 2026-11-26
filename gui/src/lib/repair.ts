// Repository repairs (ADR 0026): what each action does, how its form maps to
// the request, and which requests change the repository for good. The server
// validates every request again (shared/repair).
import { z } from 'zod'
import { i18n } from '@/i18n'
import type { RepairAction, RepairParams } from '@/types'
import {
  REPAIR_HOST_RE,
  REPAIR_MAX_FILTERS,
  REPAIR_MAX_IDS,
  REPAIR_PACK_ID_RE,
  REPAIR_SNAPSHOT_ID_RE,
  REPAIR_TAG_RE,
} from '@/lib/validation'

export interface RepairActionInfo {
  action: RepairAction
  labelKey: string
  descriptionKey: string
  // previewFirst: the action changes the repository for good, so the GUI
  // runs a read-only preview of the same request before offering it.
  previewFirst: boolean
}

// The actions offered in the GUI, in the order of restic's procedure for a
// damaged repository. find-packs is not listed: it is the preview of
// repair-packs.
export const repairActions: RepairActionInfo[] = [
  {
    action: 'check',
    labelKey: 'repair.actions.check.label',
    descriptionKey: 'repair.actions.check.description',
    previewFirst: false,
  },
  {
    action: 'unlock',
    labelKey: 'repair.actions.unlock.label',
    descriptionKey: 'repair.actions.unlock.description',
    previewFirst: false,
  },
  {
    action: 'repair-index',
    labelKey: 'repair.actions.repairIndex.label',
    descriptionKey: 'repair.actions.repairIndex.description',
    previewFirst: false,
  },
  {
    action: 'repair-snapshots',
    labelKey: 'repair.actions.repairSnapshots.label',
    descriptionKey: 'repair.actions.repairSnapshots.description',
    previewFirst: true,
  },
  {
    action: 'repair-packs',
    labelKey: 'repair.actions.repairPacks.label',
    descriptionKey: 'repair.actions.repairPacks.description',
    previewFirst: true,
  },
]

export function actionInfo(action: RepairAction): RepairActionInfo | undefined {
  return repairActions.find((a) => a.action === action)
}

// parseList splits what an admin typed or pasted (spaces, commas, new lines)
// into the values of a list field.
export function parseList(text: string): string[] {
  return text.split(/[\s,]+/).filter((v) => v !== '')
}

// The fields of the repair form, before they become a request.
export interface RepairForm {
  action: RepairAction
  readAllPacks: boolean
  readData: boolean
  forget: boolean
  hosts: string
  tags: string
  snapshotIds: string
  packIds: string
}

export function emptyRepairForm(action: RepairAction = 'check'): RepairForm {
  return { action, readAllPacks: false, readData: false, forget: false, hosts: '', tags: '', snapshotIds: '', packIds: '' }
}

// listField validates a list field as shared/repair does: at most limit
// values, each matching re.
function listField(whatKey: string, limit: number, re: RegExp, ruleKey: string) {
  return z.string().superRefine((text, ctx) => {
    const { t } = i18n.global
    const values = parseList(text)
    if (values.length > limit) {
      ctx.addIssue({ code: 'custom', message: t('repair.validation.tooMany', { limit, what: t(whatKey) }) })
      return
    }
    const bad = values.find((v) => !re.test(v))
    if (bad !== undefined) {
      ctx.addIssue({ code: 'custom', message: t('repair.validation.invalid', { what: t(whatKey), value: bad, rule: t(ruleKey) }) })
    }
  })
}

// repairFormSchema validates the repair form before any request is sent. The
// form only holds the fields of the chosen action: changing the action resets
// it.
export const repairFormSchema = z
  .object({
    action: z.enum(['unlock', 'repair-index', 'repair-snapshots', 'repair-packs', 'find-packs', 'check']),
    readAllPacks: z.boolean(),
    readData: z.boolean(),
    forget: z.boolean(),
    hosts: listField('repair.validation.what.host', REPAIR_MAX_FILTERS, REPAIR_HOST_RE, 'repair.validation.rule.host'),
    tags: listField('repair.validation.what.tag', REPAIR_MAX_FILTERS, REPAIR_TAG_RE, 'repair.validation.rule.tag'),
    snapshotIds: listField('repair.validation.what.snapshotId', REPAIR_MAX_IDS, REPAIR_SNAPSHOT_ID_RE, 'repair.validation.rule.snapshotId'),
    packIds: listField('repair.validation.what.packId', REPAIR_MAX_IDS, REPAIR_PACK_ID_RE, 'repair.validation.rule.packId'),
  })
  .superRefine((form, ctx) => {
    if ((form.action === 'repair-packs' || form.action === 'find-packs') && parseList(form.packIds).length === 0) {
      ctx.addIssue({ code: 'custom', path: ['packIds'], message: i18n.global.t('repair.validation.packIdRequired') })
    }
  })

// buildRequest turns the form into the request for the action itself (apply
// true) or for its read-only preview (apply false): repair-snapshots as a
// dry run, repair-packs as find-packs on the same packs.
export function buildRequest(form: RepairForm, apply: boolean): RepairParams {
  switch (form.action) {
    case 'repair-index':
      return form.readAllPacks ? { action: 'repair-index', read_all_packs: true } : { action: 'repair-index' }
    case 'check':
      return form.readData ? { action: 'check', read_data: true } : { action: 'check' }
    case 'repair-snapshots': {
      const p: RepairParams = { action: 'repair-snapshots' }
      if (apply) {
        p.apply = true
        if (form.forget) p.forget = true
      }
      const hosts = parseList(form.hosts)
      const tags = parseList(form.tags)
      const ids = parseList(form.snapshotIds)
      if (hosts.length) p.hosts = hosts
      if (tags.length) p.tags = tags
      if (ids.length) p.snapshot_ids = ids
      return p
    }
    case 'repair-packs':
    case 'find-packs':
      return { action: apply ? 'repair-packs' : 'find-packs', pack_ids: parseList(form.packIds) }
    default:
      return { action: form.action }
  }
}

// isDestructive mirrors shared/repair.Params.Destructive: the requests that
// need the destination's name to be confirmed.
export function isDestructive(p: RepairParams): boolean {
  return (p.action === 'repair-snapshots' && !!p.apply && !!p.forget) || p.action === 'repair-packs'
}

// previewKey identifies the request a preview was run for: applying is only
// offered after a successful preview of the very same request.
export function previewKey(form: RepairForm): string {
  return JSON.stringify(buildRequest(form, false))
}

// changeSummary says, for the confirmation dialog, what applying the request
// changes in the repository.
export function changeSummary(p: RepairParams): string {
  const { t } = i18n.global
  switch (p.action) {
    case 'repair-snapshots':
      return p.forget ? t('repair.summary.snapshotsForget') : t('repair.summary.snapshotsKeep')
    case 'repair-packs':
      return t('repair.summary.packs')
    default:
      return ''
  }
}

// formatParams lists a repair's parameters on the job page.
export function formatParams(p: RepairParams): string[] {
  const { t } = i18n.global
  const out: string[] = [t('repair.params.action', { action: p.action })]
  if (p.action === 'repair-snapshots') {
    out.push(p.apply ? (p.forget ? t('repair.params.appliedForget') : t('repair.params.applied')) : t('repair.params.dryRun'))
  }
  if (p.read_all_packs) out.push(t('repair.params.readAllPacks'))
  if (p.read_data) out.push(t('repair.params.readAllData'))
  if (p.hosts?.length) out.push(t('repair.params.hosts', { value: p.hosts.join(', ') }))
  if (p.tags?.length) out.push(t('repair.params.tags', { value: p.tags.join(', ') }))
  if (p.snapshot_ids?.length) out.push(t('repair.params.snapshots', { value: p.snapshot_ids.join(', ') }))
  if (p.pack_ids?.length) out.push(t('repair.params.packs', { value: p.pack_ids.join(', ') }))
  return out
}