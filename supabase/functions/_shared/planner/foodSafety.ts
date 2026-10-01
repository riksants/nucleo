/**
 * Keyword check for allergies, intolerances and restrictions. It runs on every
 * item, substitution and shopping entry of a plan — whether it came from the
 * AI or was typed — and blocks what matches. It errs on the side of blocking
 * (false positives over false negatives) and is not a guarantee: labels and
 * cross-contamination still need checking.
 */
import type { MealAnswers, MealPlanContent, PlannedMeal, ShoppingItem } from './types.ts'

export interface Rule {
  id: string
  label: string
  /** Normalized (no accents, lowercase) words or phrases. */
  keywords: string[]
  /** Phrases removed before matching (e.g. "leite de coco" is not dairy). */
  except?: string[]
  /** Phrases that make the whole item acceptable ("iogurte sem lactose" for lactose intolerance). */
  clears?: string[]
}

export const ALLERGENS: Rule[] = [
  {
    id: 'milk',
    label: 'Leite (alergia)',
    keywords: ['leite', 'queijo', 'iogurte', 'manteiga', 'requeijao', 'creme de leite', 'nata', 'ricota', 'mussarela', 'muçarela', 'mucarela', 'parmesao', 'whey', 'soro de leite', 'caseina', 'lactose', 'chantilly', 'coalhada', 'kefir', 'ghee', 'cream cheese', 'catupiry', 'doce de leite', 'leite condensado', 'chocolate ao leite', 'milk', 'cheese', 'yogurt', 'butter'],
    except: ['leite de coco', 'leite vegetal', 'leite de aveia', 'leite de arroz', 'leite de amendoas', 'leite de castanha', 'leite de soja', 'manteiga de amendoim', 'manteiga de cacau', 'manteiga de castanha', 'iogurte vegetal', 'iogurte de coco', 'queijo vegano', 'queijo vegetal'],
  },
  {
    id: 'egg',
    label: 'Ovo',
    keywords: ['ovo', 'ovos', 'omelete', 'gema', 'clara', 'maionese', 'merengue', 'suspiro', 'egg', 'fritata', 'quiche', 'gemada'],
    except: ['maionese vegana', 'maionese de abacate'],
  },
  {
    id: 'peanut',
    label: 'Amendoim',
    keywords: ['amendoim', 'pacoca', 'pe de moleque', 'peanut'],
  },
  {
    id: 'treenuts',
    label: 'Castanhas e nozes',
    keywords: ['castanha', 'castanhas', 'noz', 'nozes', 'amendoa', 'amendoas', 'avela', 'pistache', 'macadamia', 'caju', 'pecan', 'pinhao', 'nut', 'nuts', 'almond', 'nutella', 'marzipa'],
    except: ['noz-moscada', 'noz moscada', 'suco de caju', 'caju fruta'],
  },
  {
    id: 'wheat',
    label: 'Trigo / glúten',
    keywords: ['trigo', 'gluten', 'pao', 'paes', 'macarrao', 'massa', 'lasanha', 'pizza', 'biscoito', 'bolacha', 'bolo', 'torrada', 'cevada', 'centeio', 'malte', 'cerveja', 'cuscuz marroquino', 'semolina', 'bulgur', 'seitan', 'croissant', 'panqueca', 'wrap', 'tortilha', 'empanado', 'farinha de rosca', 'aveia', 'granola', 'nhoque', 'pastel', 'esfiha', 'coxinha', 'crepe', 'waffle', 'bread', 'pasta'],
    except: ['sem gluten', 'macarrao de arroz', 'farinha de arroz', 'farinha de mandioca', 'pao de queijo', 'cuscuz de milho', 'cuscuz nordestino', 'tapioca', 'massa de mandioca', 'aveia sem gluten', 'tortilha de milho', 'panqueca de banana', 'massa de arroz'],
  },
  {
    id: 'soy',
    label: 'Soja',
    keywords: ['soja', 'tofu', 'shoyu', 'molho de soja', 'edamame', 'missô', 'misso', 'missoshiru', 'tempeh', 'pts', 'proteina texturizada', 'soy'],
  },
  {
    id: 'fish',
    label: 'Peixe',
    keywords: ['peixe', 'atum', 'salmao', 'sardinha', 'tilapia', 'bacalhau', 'merluza', 'pescada', 'truta', 'anchova', 'robalo', 'cação', 'cacao', 'linguado', 'fish', 'tuna', 'salmon', 'molho de peixe', 'sushi', 'sashimi'],
    except: ['cacau'],
  },
  {
    id: 'shellfish',
    label: 'Crustáceos e frutos do mar',
    keywords: ['camarao', 'lagosta', 'caranguejo', 'siri', 'marisco', 'mexilhao', 'ostra', 'lula', 'polvo', 'vieira', 'frutos do mar', 'shrimp', 'crab', 'lobster'],
  },
  {
    id: 'sesame',
    label: 'Gergelim',
    keywords: ['gergelim', 'tahine', 'tahini', 'homus', 'hummus', 'sesame'],
  },
]

export const INTOLERANCES: Rule[] = [
  { id: 'lactose', label: 'Lactose', keywords: ALLERGENS[0].keywords, except: [...(ALLERGENS[0].except ?? []), 'ghee'], clears: ['sem lactose', 'zero lactose'] },
  { id: 'gluten', label: 'Glúten (intolerância/doença celíaca)', keywords: ALLERGENS[3].keywords, except: ALLERGENS[3].except, clears: ['sem gluten'] },
  { id: 'fructose', label: 'Frutose', keywords: ['mel', 'xarope de milho', 'agave', 'suco de maca', 'manga', 'pera', 'melancia', 'frutas secas', 'uva passa', 'tamara'] },
]

const MEAT = ['carne', 'boi', 'bovina', 'frango', 'galinha', 'peru', 'porco', 'suina', 'bacon', 'presunto', 'linguica', 'salsicha', 'salame', 'mortadela', 'peito de peru', 'costela', 'picanha', 'alcatra', 'patinho', 'acem', 'file mignon', 'carne moida', 'hamburguer', 'almondega', 'figado', 'cordeiro', 'pato', 'chicken', 'beef', 'pork', 'ham']
const SEAFOOD = [...ALLERGENS[5].keywords, ...ALLERGENS[6].keywords]

export const RESTRICTIONS: Rule[] = [
  { id: 'vegetarian', label: 'Vegetariano', keywords: [...MEAT, ...SEAFOOD, 'gelatina', 'caldo de carne', 'caldo de galinha'], except: ['carne vegetal', 'carne de soja', 'hamburguer vegetal', 'hamburguer de grao', 'salsicha vegetal', 'cacau', 'peito de peru vegetal'] },
  { id: 'vegan', label: 'Vegano', keywords: [...MEAT, ...SEAFOOD, ...ALLERGENS[0].keywords, ...ALLERGENS[1].keywords, 'mel', 'gelatina', 'caldo de carne', 'caldo de galinha'], except: [...(ALLERGENS[0].except ?? []), ...(ALLERGENS[1].except ?? []), 'carne vegetal', 'carne de soja', 'hamburguer vegetal', 'hamburguer de grao', 'cacau', 'melao', 'melancia'] },
  { id: 'nopork', label: 'Sem carne de porco', keywords: ['porco', 'suina', 'suino', 'bacon', 'presunto', 'linguica', 'salame', 'mortadela', 'pancetta', 'torresmo', 'lombo', 'pernil', 'copa', 'pork', 'ham'], except: ['linguica de frango', 'presunto de peru', 'linguica vegetal'] },
  { id: 'noredmeat', label: 'Sem carne vermelha', keywords: ['carne bovina', 'boi', 'picanha', 'alcatra', 'patinho', 'acem', 'file mignon', 'carne moida', 'costela', 'cordeiro', 'porco', 'suina', 'bacon', 'beef'], except: [] },
  { id: 'noseafood', label: 'Sem peixes e frutos do mar', keywords: SEAFOOD, except: ['cacau'] },
  { id: 'noalcohol', label: 'Sem álcool', keywords: ['vinho', 'cerveja', 'cachaca', 'licor', 'rum', 'conhaque', 'vodka'], except: ['vinagre de vinho'] },
]

export function normalizeFood(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hits(text: string, rule: Rule): boolean {
  let t = ` ${normalizeFood(text)} `
  if (rule.clears?.some((c) => t.includes(normalizeFood(c)))) return false
  for (const e of rule.except ?? []) t = t.split(` ${normalizeFood(e)} `).join(' ').split(normalizeFood(e)).join(' ')
  return rule.keywords.some((k) => {
    const kw = normalizeFood(k)
    if (!kw) return false
    // Whole word / phrase, allowing a plural "s".
    return new RegExp(`(^|\\s)${kw.replace(/[-]/g, '\\-')}s?(?=\\s|$)`).test(t)
  })
}

/** Every rule active for these answers: allergies, intolerances, restrictions and dislikes. */
export function activeRules(a: Pick<MealAnswers, 'allergies' | 'intolerances' | 'restrictions' | 'dislikes'>): Rule[] {
  const custom = (list: string[], prefix: string): Rule[] =>
    list
      .filter((x) => !ALLERGENS.concat(INTOLERANCES, RESTRICTIONS).some((r) => r.id === x))
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => ({ id: `${prefix}:${x}`, label: x, keywords: [x] }))
  const dislikes = a.dislikes
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => ({ id: `dislike:${x}`, label: `não come: ${x}`, keywords: [x] }))
  return [
    ...ALLERGENS.filter((r) => a.allergies.includes(r.id)),
    ...custom(a.allergies, 'allergy'),
    ...INTOLERANCES.filter((r) => a.intolerances.includes(r.id)),
    ...custom(a.intolerances, 'intolerance'),
    ...RESTRICTIONS.filter((r) => a.restrictions.includes(r.id)),
    ...custom(a.restrictions, 'restriction'),
    ...dislikes,
  ]
}

export function violations(text: string, rules: Rule[]): Rule[] {
  return rules.filter((r) => hits(text, r))
}

/** Words that point to extreme restriction; notes containing them are dropped. */
const EXTREME = ['jejum', 'detox', 'dieta da sopa', 'so liquidos', 'pular refeic', 'nao comer', 'zero carbo', 'sem carboidrato', 'cetogenica', 'low carb extremo', '800 kcal', '1000 kcal', 'diuretico', 'laxante', 'corte de peso', 'desidrat']

export function isExtreme(text: string): boolean {
  const t = normalizeFood(text)
  return EXTREME.some((w) => t.includes(normalizeFood(w)))
}

/** Removes everything incompatible from a plan and lists what was removed and why. */
export function sanitizeMealPlan(plan: MealPlanContent, answers: MealAnswers): { meals: PlannedMeal[]; shopping: ShoppingItem[]; notes: string; removed: string[] } {
  const rules = activeRules(answers)
  const removed: string[] = []
  const keep = (text: string, where: string) => {
    const v = violations(text, rules)
    if (!v.length) return true
    removed.push(`${text} (${where}) — ${v.map((r) => r.label).join(', ')}`)
    return false
  }
  const meals = plan.meals.map((m) => ({
    ...m,
    items: m.items.filter((i) => keep(i, m.label)),
    substitutions: m.substitutions.filter((s) => keep(s, `substituição · ${m.label}`)),
  }))
  const shopping = plan.shopping.filter((s) => keep(s.item, 'lista de compras'))
  const noteLines = plan.notes.split('\n').filter((line) => {
    if (isExtreme(line)) {
      removed.push(`Orientação removida por sugerir restrição extrema: “${line.trim()}”`)
      return false
    }
    return true
  })
  return { meals, shopping, notes: noteLines.join('\n'), removed }
}

export function emptyMealAnswers(): MealAnswers {
  return {
    goal: 'health',
    athlete: false,
    modality: '',
    allergies: [],
    intolerances: [],
    restrictions: [],
    dislikes: '',
    likes: '',
    budget: 'medium',
    budgetNote: '',
    cookMinutes: 30,
    equipment: ['fogão', 'geladeira'],
    mealsPerDay: 4,
    mealTimes: ['07:30', '12:30', '16:00', '20:00'],
    clinical: false,
    clinicalNote: '',
    performanceStrategy: false,
  }
}
