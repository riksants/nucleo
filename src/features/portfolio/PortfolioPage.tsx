import { Briefcase, ExternalLink, ImagePlus, X } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../../app/Shell'
import { optionOf, PROJECT_KIND } from '../../data/labels'
import { useStore } from '../../data/store'
import type { PortfolioItem, ProjectKind } from '../../data/types'
import { formatDateValue, toDateInput } from '../../lib/dates'
import { compressImage } from '../../lib/image'
import { displayUrl, normalizeUrl, safeImage } from '../../lib/links'
import { EmptyState } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft, useSheet } from '../../ui/formHooks'
import { Chips, Segmented } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { ClientSelect } from '../shared/RelationSelect'
import { useNames } from '../shared/useNames'
import { useOpenParam } from '../useOpenParam'

function PortfolioForm({ open, onClose, item }: { open: boolean; onClose(): void; item: PortfolioItem | null }) {
  const { save } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const [d, set] = useDraft(open, () => ({
    name: item?.name ?? '',
    kind: item?.kind ?? ('site' as ProjectKind),
    clientId: item?.clientId ?? null,
    link: item?.link ?? '',
    date: item?.date ?? toDateInput(),
    image: item?.image ?? '',
    notes: item?.notes ?? '',
  }))

  const pickImage = async (file: File | undefined) => {
    if (!file) return
    try {
      set('image', await compressImage(file))
    } catch {
      toast('Não foi possível ler a imagem', 'error')
    }
  }

  const submit = async () => {
    if (!d.name.trim()) return 'Dê um nome ao trabalho'
    await save('portfolio', { ...item, ...d, name: d.name.trim(), link: d.link.trim(), notes: d.notes.trim() })
    toast(item ? 'Trabalho atualizado' : 'Trabalho adicionado')
    onClose()
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={item ? 'Editar trabalho' : 'Novo trabalho'}
      submitLabel={item ? 'Salvar' : 'Adicionar'}
      onSubmit={submit}
      size="lg"
      onDelete={item ? () => del('portfolio', item.id, 'trabalho', { after: onClose }) : undefined}
    >
      <FormGrid>
        <Field label="Imagem" hint="opcional">
          {d.image ? (
            <div className="relative overflow-hidden rounded-2xl border border-line bg-tint/[0.04]">
              <img src={safeImage(d.image)} alt="" className="max-h-56 w-full object-contain" />
              <button type="button" onClick={() => set('image', '')} aria-label="Remover imagem" className="absolute top-2 right-2 grid size-9 place-items-center rounded-full bg-black/60 text-on-accent backdrop-blur reduce-transparency:bg-black reduce-transparency:backdrop-blur-none">
                <X size={18} />
              </button>
            </div>
          ) : (
            <span className="flex aspect-[16/6] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong bg-raised text-sm text-soft hover:text-ink">
              <ImagePlus size={24} />
              Escolher imagem
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => pickImage(e.target.files?.[0])} />
            </span>
          )}
        </Field>
        <Field label="Nome">
          <TextInput value={d.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="half">
          <Field label="Tipo">
            <Segmented block value={d.kind} onChange={(v) => set('kind', v)} options={PROJECT_KIND} />
          </Field>
        </div>
        <div className="half">
          <Field label="Data">
            <TextInput type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Cliente" hint="opcional">
            <ClientSelect value={d.clientId} onChange={(v) => set('clientId', v)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Link" hint="opcional">
            <TextInput type="url" inputMode="url" autoCapitalize="none" value={d.link} onChange={(e) => set('link', e.target.value)} placeholder="site.com" />
          </Field>
        </div>
        <Field label="Descrição" hint="o que foi feito, resultado, seu papel">
          <TextArea rows={4} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}

const YEAR = (date: string) => date.slice(0, 4)

/** The picture of a work, or its initial on a quiet tile when there is none. Never larger than it needs to be. */
function Cover({ item, className }: { item: PortfolioItem; className: string }) {
  return item.image ? (
    <img src={safeImage(item.image)} alt="" loading="lazy" className={`${className} bg-tint/[0.04] object-cover`} />
  ) : (
    <div aria-hidden className={`${className} grid place-items-center bg-tint/[0.03] bg-[radial-gradient(120%_90%_at_100%_0%,color-mix(in_oklab,var(--color-accent)_16%,transparent),transparent_60%)]`}>
      <span className="text-[28px] font-semibold tracking-[-0.04em] text-accent-hi/70">{item.name.slice(0, 1).toUpperCase()}</span>
    </div>
  )
}

/** A work, read like a studio case: picture (contained, never cropped), what it is, for whom, when, and the link. */
function CaseSheet({ item, onClose, onEdit }: { item: PortfolioItem | null; onClose(): void; onEdit(i: PortfolioItem): void }) {
  const names = useNames()
  return (
    <Sheet open={!!item} onClose={onClose} title={item?.name ?? ''} size="lg">
      {item && (
        <div className="space-y-4">
          {item.image && (
            <div className="overflow-hidden rounded-2xl bg-tint/[0.04]">
              <img src={safeImage(item.image)} alt={`Imagem de ${item.name}`} className="mx-auto max-h-[46dvh] w-full object-contain" />
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-[13px]">
            <span className="rounded-full bg-accent/[0.12] px-2.5 py-1 font-semibold text-accent-hi">{optionOf(PROJECT_KIND, item.kind).label}</span>
            {names.client(item.clientId) && <span className="rounded-full bg-tint/[0.06] px-2.5 py-1 font-medium text-soft">{names.client(item.clientId)}</span>}
            {item.date && <span className="rounded-full bg-tint/[0.06] px-2.5 py-1 font-medium text-soft">{formatDateValue(item.date)}</span>}
          </div>
          {item.notes ? <p className="text-[16px] leading-relaxed whitespace-pre-wrap text-soft">{item.notes}</p> : <p className="text-[15px] text-faint">Sem descrição.</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            {item.link && (
              <a href={normalizeUrl(item.link)} target="_blank" rel="noreferrer" className="press inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-semibold text-on-accent hover:bg-accent-soft">
                Ver projeto <ExternalLink size={16} />
              </a>
            )}
            <button type="button" onClick={() => onEdit(item)} className="press inline-flex h-11 items-center rounded-full px-5 text-[15px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
              Editar
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

type KindFilter = 'all' | ProjectKind

export function PortfolioPage() {
  const { data } = useStore()
  const names = useNames()
  const form = useSheet<PortfolioItem>()
  const detail = useSheet<PortfolioItem>()
  const [kind, setKind] = useState<KindFilter>('all')
  useOpenParam(data.portfolio, detail.show)
  const all = [...data.portfolio].sort((a, b) => (a.date < b.date ? 1 : -1))
  const list = all.filter((p) => kind === 'all' || p.kind === kind)
  const [featured, ...rest] = list
  const clients = new Set(all.map((p) => p.clientId).filter(Boolean)).size
  const meta = (p: PortfolioItem) => [optionOf(PROJECT_KIND, p.kind).label, names.client(p.clientId), YEAR(p.date)].filter(Boolean).join(' · ')

  return (
    <>
      <PageHeader
        rich
        icon={Briefcase}
        eyebrow="Trabalhos entregues"
        title="Portfólio"
        primary={{ label: 'Adicionar', aria: 'Adicionar ao portfólio', onPress: () => form.show() }}
        stats={
          all.length
            ? [
                { label: all.length === 1 ? 'Trabalho' : 'Trabalhos', value: all.length },
                { label: 'Clientes', value: clients },
                { label: 'Mais recente', value: all[0].date ? YEAR(all[0].date) : '—' },
              ]
            : undefined
        }
      />
      {all.length === 0 ? (
        <EmptyState icon={<Briefcase size={20} />} title="Nenhum trabalho ainda" text="Monte sua vitrine: o que você entregou, para quem e o link para ver." action="Adicionar trabalho" onAction={() => form.show()} />
      ) : (
        <>
          <div className="mb-5">
            <Chips<KindFilter> value={kind} onChange={setKind} options={[{ value: 'all', label: 'Todos' }, ...PROJECT_KIND.map((k) => ({ value: k.value as KindFilter, label: k.label }))]} />
          </div>
          {!featured ? (
            <EmptyState compact icon={<Briefcase size={20} />} title="Nada deste tipo" action="Ver todos" onAction={() => setKind('all')} />
          ) : (
            <>
              {/* The latest work, a little larger: picture beside the text on the computer, above it on the phone. */}
              <button type="button" onClick={() => detail.show(featured)} className="card mb-6 grid w-full grid-cols-[minmax(0,1fr)] overflow-hidden text-left transition-colors hover:border-line-strong lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <Cover item={featured} className={`w-full lg:aspect-auto lg:h-full lg:min-h-64 ${featured.image ? 'aspect-[16/9]' : 'aspect-[16/6]'}`} />
                <span className="flex flex-col justify-center p-5 lg:p-7">
                  <span className="text-[12px] font-semibold tracking-[0.1em] text-accent-hi uppercase">Mais recente</span>
                  <span className="mt-1 text-[24px] leading-tight font-semibold tracking-[-0.035em] [overflow-wrap:anywhere] lg:text-[30px]">{featured.name}</span>
                  <span className="mt-1 text-[14px] text-soft">{meta(featured)}</span>
                  {featured.notes && <span className="mt-3 line-clamp-3 text-[15px] leading-relaxed text-soft">{featured.notes}</span>}
                  {featured.link && (
                    <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent-hi">
                      {displayUrl(featured.link)} <ExternalLink size={14} />
                    </span>
                  )}
                </span>
              </button>
              {rest.length > 0 && (
                <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {rest.map((p) => (
                    <button key={p.id} type="button" onClick={() => detail.show(p)} className="card flex w-full gap-3.5 overflow-hidden p-2.5 text-left transition-colors hover:border-line-strong sm:flex-col sm:p-0">
                      <Cover item={p} className="aspect-[4/3] w-28 shrink-0 rounded-xl sm:w-full sm:rounded-none" />
                      <span className="min-w-0 flex-1 py-1 pr-1 sm:px-4 sm:pt-0 sm:pb-4">
                        <span className="block truncate text-[16px] font-semibold tracking-tight">{p.name}</span>
                        <span className="block truncate text-[12px] text-faint">{meta(p)}</span>
                        {p.notes && <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-soft">{p.notes}</span>}
                        {p.link && <span className="mt-1.5 block truncate text-[12px] font-semibold text-accent-hi">{displayUrl(p.link)}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
      <CaseSheet
        item={detail.item ?? null}
        onClose={detail.close}
        onEdit={(i) => {
          detail.close()
          form.show(i)
        }}
      />
      <PortfolioForm open={form.open} onClose={form.close} item={form.item} />
    </>
  )
}
