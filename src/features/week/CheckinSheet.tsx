import { useStore } from '../../data/store'
import type { CheckinTopic, WeekCheckin, WeekId } from '../../data/types'
import { Button } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { TextArea } from '../../ui/Field'
import { useDraft } from '../../ui/formHooks'
import { Sheet } from '../../ui/Sheet'
import { weekLabel } from './GoalForm'

export const CHECKIN_TOPICS: { id: CheckinTopic; question: string }[] = [
  { id: 'energy', question: 'Como ficou sua energia?' },
  { id: 'productivity', question: 'Como ficou sua produtividade?' },
  { id: 'food', question: 'Como foi sua alimentação?' },
  { id: 'training', question: 'Como foi seu treino?' },
  { id: 'sleep', question: 'Como foi seu sono?' },
  { id: 'mood', question: 'Como ficou seu humor?' },
  { id: 'organization', question: 'Como ficou sua organização?' },
]

const SCALE = [1, 2, 3, 4, 5] as const

/** Quick weekly check-in: 1–5 per topic, all optional. One record per week (id = week). */
export function CheckinSheet({ open, onClose, week }: { open: boolean; onClose(): void; week: WeekId }) {
  const { data, save } = useStore()
  const { toast } = useFeedback()
  const existing = data.weekCheckins.find((c) => c.id === week) ?? null
  // Reloaded from the saved record every time the sheet opens (also after a sync).
  const [d, set] = useDraft(open, () => ({ answers: (existing?.answers ?? {}) as WeekCheckin['answers'], note: existing?.note ?? '' }))
  const answers = d.answers
  const note = d.note
  const setAnswers = (fn: (a: WeekCheckin['answers']) => WeekCheckin['answers']) => set('answers', fn(d.answers))
  const setNote = (v: string) => set('note', v)

  const submit = async () => {
    // Fixed id = the week: a check-in can never overwrite another week's.
    await save('weekCheckins', { ...existing, id: week, week, answers, note: note.trim() })
    toast('Check-in salvo')
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Check-in · ${weekLabel(week)}`}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" size="lg" onClick={onClose}>
            Pular
          </Button>
          <Button size="lg" block onClick={submit}>
            Salvar
          </Button>
        </div>
      }
    >
      <p className="pb-4 text-[14px] text-faint">De 1 (baixo) a 5 (ótimo). Responda só o que quiser.</p>
      <div className="space-y-4">
        {CHECKIN_TOPICS.map((t) => (
          <div key={t.id}>
            <p className="mb-2 text-[15px]">{t.question}</p>
            <div className="flex gap-2" role="radiogroup" aria-label={t.question}>
              {SCALE.map((v) => {
                const on = answers[t.id] === v
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`${v}`}
                    onClick={() => setAnswers((a) => ({ ...a, [t.id]: on ? undefined : v }))}
                    className={`press num grid h-11 flex-1 place-items-center rounded-xl border text-[16px] font-semibold ${on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-soft hover:text-ink'}`}
                  >
                    {v}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        <div>
          <p className="mb-2 text-[15px]">Quer registrar alguma coisa sobre sua semana?</p>
          <TextArea rows={3} value={note} placeholder="Opcional" onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Sheet>
  )
}
