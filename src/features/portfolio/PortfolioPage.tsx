import { Briefcase, ExternalLink, FolderKanban, ImagePlus, Sparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { isEnabled } from '../../app/modules'
import { navigate } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { parsePortfolio } from '../../core/portfolioText'
import { optionOf, PROJECT_KIND } from '../../data/labels'
import { matches } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { PortfolioItem, ProjectKind } from '../../data/types'
import { formatDateValue, toDateInput } from '../../lib/dates'
import { compressImage } from '../../lib/image'
import { displayUrl, normalizeUrl, safeImage } from '../../lib/links'
import { Button } from '../../ui/Button'
import { EmptyState, SearchField } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, Select, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft, useSheet } from '../../ui/formHooks'
import { Chips, Segmented } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { MoreOptions } from '../daily/SmartCapture'
import { ClientSelect } from '../shared/RelationSelect'
import { useNames } from '../shared/useNames'
import { useOpenParam } from '../useOpenParam'

type Status = NonNullable<PortfolioItem['status']>
const STATUS_LABEL: Record<Status, string> = { done: 'Concluído', inProgress: 'Em andamento', paused: 'Pausado' }

/**
 * Personal and private: the works themselves (name, type, category, status, link, picture) and, if wanted,
 * the Núcleo project it came from. A sentence can fill the fields it contains; nothing is invented.
 */
function PortfolioForm({ open, onClose, item }: { open: boolean; onClose(): void; item: PortfolioItem | null }) {
  const { data, settings, save } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const [line, setLine] = useState('')
  const [d, set, setAll] = useDraft(open, () => ({
    name: item?.name ?? '',
    kind: item?.kind ?? ('site' as ProjectKind),
    clientId: item?.clientId ?? null,
    link: item?.link ?? '',
    date: item?.date ?? toDateInput(),
    image: item?.image ?? '',
    notes: item?.notes ?? '',
    category: item?.category ?? '',
    status: (item?.status ?? '') as Status | '',
    projectId: item?.projectId ?? '',
  }))
  const categories = [...new Set(data.portfolio.map((p) => p.category?.trim()).filter(Boolean) as string[])].sort()
  const projects = data.projects
  const fill = () => {
    if (!line.trim()) return
    const p = parsePortfolio(line)
    setAll((x) => ({ ...x, name: p.name || x.name, kind: p.kind, link: p.link || x.link, category: p.category || x.category, status: p.status || x.status }))
  }
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
    const { status, projectId, category, ...rest } = d
    await save('portfolio', {
      ...item,
      ...rest,
      name: d.name.trim(),
      link: d.link.trim(),
      notes: d.notes.trim(),
      category: category.trim() || undefined,
      status: status || undefined,
      projectId: projectId || undefined,
    })
    toast(item ? 'Trabalho atualizado' : 'Trabalho adicionado')
    setLine('')
    onClose()
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={item ? 'Editar trabalho' : 'Novo trabalho'}
      submitLabel={item ? 'Salvar' : 'Adicionar'}
      onSubmit={submit}
      onDelete={item ? () => del('portfolio', item.id, 'trabalho', { after: onClose }) : undefined}
    >
      <FormGrid>
        {!item && (
          <div className="flex gap-2">
            <TextInput aria-label="Descrever em uma frase" placeholder="Ex.: Site para uma lavanderia, categoria web, concluído" value={line} onChange={(e) => setLine(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), fill())} />
            <Button variant="secondary" icon={<Sparkles size={16} />} onClick={fill} disabled={!line.trim()} className="h-12! shrink-0 px-4!">
              Preencher
            </Button>
          </div>
        )}
        <Field label="Nome">
          <TextInput value={d.name} onChange={(e) => set('name', e.target.value)} autoFocus={!item} />
        </Field>
        <Field label="Tipo">
          <Segmented block value={d.kind} onChange={(v) => set('kind', v)} options={PROJECT_KIND} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoria" hint="opcional">
            <TextInput list="portfolio-categories" value={d.category} placeholder="Ex.: Web" onChange={(e) => set('category', e.target.value)} />
            <datalist id="portfolio-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Situação" hint="opcional">
            <Select value={d.status} onChange={(e) => set('status', e.target.value as Status | '')}>
              <option value="">—</option>
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Link" hint="opcional">
          <TextInput type="url" inputMode="url" autoCapitalize="none" value={d.link} onChange={(e) => set('link', e.target.value)} placeholder="site.com" />
        </Field>
        <MoreOptions defaultOpen={Boolean(item && (item.image || item.notes || item.clientId || item.projectId))}>
          <Field label="Imagem" hint="opcional">
            {d.image ? (
              <div className="relative overflow-hidden rounded-2xl border border-line bg-tint/[0.04]">
                <img src={safeImage(d.image)} alt="" className="max-h-44 w-full object-contain" />
                <button type="button" onClick={() => set('image', '')} aria-label="Remover imagem" className="absolute top-2 right-2 grid size-9 place-items-center rounded-full bg-black/60 text-on-accent backdrop-blur reduce-transparency:bg-black reduce-transparency:backdrop-blur-none">
                  <X size={18} />
                </button>
              </div>
            ) : (
              <span className="flex h-20 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong bg-raised text-sm text-soft hover:text-ink">
                <ImagePlus size={20} />
                Escolher imagem
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => pickImage(e.target.files?.[0])} />
              </span>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data">
              <TextInput type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <Field label="Cliente" hint="opcional">
              <ClientSelect value={d.clientId} onChange={(v) => set('clientId', v)} />
            </Field>
          </div>
          {isEnabled(settings, 'projects') && projects.length > 0 && (
            <Field label="Projeto do Núcleo" hint="opcional · só um atalho, não muda o projeto">
              <Select value={d.projectId} onChange={(e) => set('projectId', e.target.value)}>
                <option value="">Nenhum</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Descrição" hint="o que foi feito, seu papel">
            <TextArea rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </MoreOptions>
      </FormGrid>
    </FormSheet>
  )
}

const YEAR = (date: string) => date.slice(0, 4)

/** The picture of a work, or its initial on a quiet tile when there is none. Always the same proportion. */
function Cover({ item, className }: { item: PortfolioItem; className: string }) {
  return item.image ? (
    <img src={safeImage(item.image)} alt="" loading="lazy" className={`${className} bg-tint/[0.04] object-cover`} />
  ) : (
    <div aria-hidden className={`${className} grid place-items-center bg-tint/[0.03] bg-[radial-gradient(120%_90%_at_100%_0%,color-mix(in_oklab,var(--color-accent)_16%,transparent),transparent_60%)]`}>
      <span className="text-[20px] font-semibold tracking-[-0.04em] text-accent-hi/70">{item.name.slice(0, 1).toUpperCase()}</span>
    </div>
  )
}

function CaseSheet({ item, onClose, onEdit }: { item: PortfolioItem | null; onClose(): void; onEdit(i: PortfolioItem): void }) {
  const names = useNames()
  const { data } = useStore()
  const project = item?.projectId ? data.projects.find((p) => p.id === item.projectId) : undefined
  return (
    <Sheet open={!!item} onClose={onClose} title={item?.name ?? ''}>
      {item && (
        <div className="space-y-4">
          {item.image && (
            <div className="overflow-hidden rounded-2xl bg-tint/[0.04]">
              <img src={safeImage(item.image)} alt={`Imagem de ${item.name}`} className="mx-auto max-h-[34dvh] w-full object-contain" />
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-[13px]">
            <span className="rounded-full bg-accent/[0.12] px-2.5 py-1 font-semibold text-accent-hi">{item.category || optionOf(PROJECT_KIND, item.kind).label}</span>
            {item.status && <span className="rounded-full bg-tint/[0.06] px-2.5 py-1 font-medium text-soft">{STATUS_LABEL[item.status]}</span>}
            {names.client(item.clientId) && <span className="rounded-full bg-tint/[0.06] px-2.5 py-1 font-medium text-soft">{names.client(item.clientId)}</span>}
            {item.date && <span className="rounded-full bg-tint/[0.06] px-2.5 py-1 font-medium text-soft">{formatDateValue(item.date)}</span>}
          </div>
          {item.notes ? <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-soft">{item.notes}</p> : <p className="text-[14px] text-faint">Sem descrição.</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            {item.link && (
              <a href={normalizeUrl(item.link)} target="_blank" rel="noreferrer" className="press inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-semibold text-on-accent hover:bg-accent-soft">
                Abrir link <ExternalLink size={16} />
              </a>
            )}
            {project && (
              <button type="button" onClick={() => (onClose(), navigate('/projects', { open: project.id }))} className="press inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-medium ring-1 ring-line-strong ring-inset hover:bg-tint/[0.05]">
                <FolderKanban size={16} /> {project.name}
              </button>
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

export function PortfolioPage() {
  const { data } = useStore()
  const names = useNames()
  const form = useSheet<PortfolioItem>()
  const detail = useSheet<PortfolioItem>()
  const [group, setGroup] = useState('all')
  const [query, setQuery] = useState('')
  useOpenParam(data.portfolio, detail.show)
  const all = useMemo(() => [...data.portfolio].sort((a, b) => (a.date < b.date ? 1 : -1)), [data.portfolio])
  // Filters by category when the person uses categories, otherwise by type.
  const categories = [...new Set(all.map((p) => p.category?.trim()).filter(Boolean) as string[])].sort()
  const byCategory = categories.length > 0
  const options = [{ value: 'all', label: 'Todos' }, ...(byCategory ? categories.map((c) => ({ value: `c:${c}`, label: c })) : PROJECT_KIND.filter((k) => all.some((p) => p.kind === k.value)).map((k) => ({ value: `k:${k.value}`, label: k.label })))]
  const list = all
    .filter((p) => group === 'all' || (group.startsWith('c:') ? p.category?.trim() === group.slice(2) : p.kind === group.slice(2)))
    .filter((p) => matches(query, `${p.name} ${p.category ?? ''} ${p.notes} ${p.link} ${names.client(p.clientId) ?? ''}`))
  const clients = new Set(all.map((p) => p.clientId).filter(Boolean)).size
  const meta = (p: PortfolioItem) => [p.category || optionOf(PROJECT_KIND, p.kind).label, p.status ? STATUS_LABEL[p.status] : '', YEAR(p.date)].filter(Boolean).join(' · ')

  return (
    <>
      <PageHeader
        rich
        icon={Briefcase}
        eyebrow="Seus trabalhos, só para você"
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
        <EmptyState icon={<Briefcase size={20} />} title="Nenhum trabalho ainda" text="Guarde o que você fez: nome, categoria, link e uma imagem. Dá para descrever numa frase e conferir antes de salvar." action="Adicionar trabalho" onAction={() => form.show()} />
      ) : (
        <>
          <div className="mb-4 space-y-3">
            {all.length > 4 && <SearchField value={query} onChange={setQuery} placeholder="Buscar no portfólio" />}
            {options.length > 2 && <Chips value={group} onChange={setGroup} options={options} />}
          </div>
          {!list.length ? (
            <EmptyState
              compact
              icon={<Briefcase size={20} />}
              title="Nada encontrado"
              action="Ver todos"
              onAction={() => {
                setGroup('all')
                setQuery('')
              }}
            />
          ) : (
            <>
              {/* Phone: compact rows with a small picture. Computer: a grid, every picture in the same proportion. */}
              <ul className="card divide-y divide-line lg:hidden">
                {list.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => detail.show(p)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-tint/[0.03] tap">
                      <Cover item={p} className="aspect-[4/3] w-16 shrink-0 rounded-lg" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{p.name}</span>
                        <span className="block truncate text-[12px] text-faint">{meta(p)}</span>
                        {p.link && <span className="block truncate text-[12px] font-medium text-accent-hi">{displayUrl(p.link)}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="hidden gap-4 lg:grid lg:grid-cols-3">
                {list.map((p) => (
                  <button key={p.id} type="button" onClick={() => detail.show(p)} className="card flex w-full flex-col overflow-hidden text-left transition-colors hover:border-line-strong">
                    <Cover item={p} className="aspect-[16/10] w-full" />
                    <span className="min-w-0 p-4">
                      <span className="block truncate text-[16px] font-semibold tracking-tight">{p.name}</span>
                      <span className="block truncate text-[12px] text-faint">{meta(p)}</span>
                      {p.notes && <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-soft">{p.notes}</span>}
                    </span>
                  </button>
                ))}
              </div>
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
