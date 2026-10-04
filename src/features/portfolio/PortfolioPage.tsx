import { Briefcase, ExternalLink, ImagePlus, Plus, X } from 'lucide-react'
import { PageHeader } from '../../app/Shell'
import { optionOf, PROJECT_KIND } from '../../data/labels'
import { useStore } from '../../data/store'
import type { PortfolioItem, ProjectKind } from '../../data/types'
import { formatDateValue, toDateInput } from '../../lib/dates'
import { compressImage } from '../../lib/image'
import { displayUrl, normalizeUrl } from '../../lib/links'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft, useSheet } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
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
            <div className="relative overflow-hidden rounded-2xl border border-line">
              <img src={d.image} alt="" className="aspect-[16/10] w-full object-cover" />
              <button type="button" onClick={() => set('image', '')} aria-label="Remover imagem" className="absolute top-2 right-2 grid size-9 place-items-center rounded-full bg-black/60 text-white backdrop-blur reduce-transparency:bg-black reduce-transparency:backdrop-blur-none">
                <X size={18} />
              </button>
            </div>
          ) : (
            <span className="flex aspect-[16/7] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong bg-raised text-sm text-soft hover:text-ink">
              <ImagePlus size={22} />
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
        <Field label="Observações" hint="opcional">
          <TextArea rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}

export function PortfolioPage() {
  const { data } = useStore()
  const names = useNames()
  const form = useSheet<PortfolioItem>()
  useOpenParam(data.portfolio, form.show)
  const list = [...data.portfolio].sort((a, b) => (a.date < b.date ? 1 : -1))

  return (
    <>
      <PageHeader
        title="Portfólio"
        subtitle={list.length ? `${list.length} ${list.length === 1 ? 'trabalho' : 'trabalhos'}` : undefined}
        actions={
          <Button icon={<Plus size={18} />} onClick={() => form.show()}>
            Adicionar
          </Button>
        }
      />
      {list.length === 0 ? (
        <EmptyState icon={<Briefcase size={22} />} title="Nenhum trabalho ainda" text="Registre o que você já construiu para olhar depois." action="Adicionar trabalho" onAction={() => form.show()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (
            <article key={p.id} className="card overflow-hidden">
              <button type="button" onClick={() => form.show(p)} className="block w-full text-left">
                {p.image ? (
                  <img src={p.image} alt="" loading="lazy" className="aspect-[16/10] w-full object-cover" />
                ) : (
                  <div className="grid aspect-[16/10] place-items-center bg-[linear-gradient(135deg,#1c1d2b,#121216)] text-4xl font-semibold text-white/15">{p.name.slice(0, 1).toUpperCase()}</div>
                )}
                <div className="p-4">
                  <h3 className="truncate text-[16px] font-semibold tracking-tight">{p.name}</h3>
                  <p className="mt-0.5 truncate text-[13px] text-faint">
                    {[optionOf(PROJECT_KIND, p.kind).label, names.client(p.clientId), formatDateValue(p.date)].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </button>
              {p.link && (
                <a href={normalizeUrl(p.link)} target="_blank" rel="noreferrer" className="mx-4 mb-4 -mt-1 inline-flex items-center gap-1.5 text-sm text-accent-hi">
                  {displayUrl(p.link)}
                  <ExternalLink size={14} />
                </a>
              )}
            </article>
          ))}
        </div>
      )}
      <PortfolioForm open={form.open} onClose={form.close} item={form.item} />
    </>
  )
}
