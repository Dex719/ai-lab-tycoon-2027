import { describe, expect, it } from 'vitest';
import { RIVAL_MODELS } from './catalog';
import { RIVAL_REACTIVE } from './rivalReactive';
import { BENCHMARKS } from './benchmarks';
import { LABS } from './labs';
import { GPUS } from './gpus';
import { REAL_NAME_PAIRS, toRealNames } from './realNames';

describe('toRealNames', () => {
  it('меняет лаборатории, модели, тесты и поставщика', () => {
    expect(toRealNames('OpenBrain выпустила ChatGTP')).toBe('OpenAI выпустила ChatGPT');
    expect(toRealNames('Clade 3.5 Sonet и Gemeni 1.5 Flesh')).toBe('Claude 3.5 Sonnet и Gemini 1.5 Flash');
    expect(toRealNames('SQuAT, GLUU, MMLO, HumanEvol, GSM8C, SWE-banch, GPQE')).toBe(
      'SQuAD, GLUE, MMLU, HumanEval, GSM8K, SWE-bench, GPQA',
    );
    expect(toRealNames('Fermi H100')).toBe('NVIDIA H100');
    expect(toRealNames('q1-Previow')).toBe('o1-Preview');
    expect(toRealNames('Berd, Kimo, GML-4, Qwin2.5, PaLN, LaMBA, Chinchella, Gopler, Meeno')).toBe(
      'Bard, Kimi, GLM-4, Qwen2.5, PaLM, LaMDA, Chinchilla, Gopher, Meena',
    );
  });

  it('меняет названия из исторических событий', () => {
    expect(toRealNames('AlfaGo Zeru, AlfaFold, LLaMo 2, Soru, DALL-I 2, Stabil Diffuzion, Berd, LaMBA')).toBe(
      'AlphaGo Zero, AlphaFold, LLaMA 2, Sora, DALL-E 2, Stable Diffusion, Bard, LaMDA',
    );
  });

  it('сначала длинные совпадения', () => {
    expect(toRealNames('Gogle DeepMynd')).toBe('Google DeepMind');
    expect(toRealNames('Gogle')).toBe('Google');
    expect(toRealNames('ChatGML2-6B')).toBe('ChatGLM2-6B');
    expect(toRealNames('Moonshoot')).toBe('Moonshot AI');
    expect(toRealNames('Moonshoot AI')).toBe('Moonshot AI');
  });

  it('меняет производные названия', () => {
    expect(toRealNames('DeepSeak-V2 Lito')).toBe('DeepSeek-V2 Lite');
    expect(toRealNames('GTP-4o Mino')).toBe('GPT-4o mini');
    expect(toRealNames('Qwin2.5-Turbu')).toBe('Qwen2.5-Turbo');
  });

  it('не трогает русские слова и части слов', () => {
    const s = 'Агент выбрал Мино и Клад; Minor, Berdy, GTPX, XGTP, Qwinter, Q1';
    expect(toRealNames(s)).toBe(s);
  });

  it('идемпотентна', () => {
    const texts = [
      ...RIVAL_MODELS.map((m) => m.gameName),
      ...RIVAL_REACTIVE.map((t) => t.gameName),
      ...BENCHMARKS.map((b) => b.name),
      ...LABS.map((l) => l.name),
      ...GPUS.map((g) => g.name),
      'Gogle DeepMynd, Moonshoot AI и OpenBrain',
    ];
    for (const t of texts) {
      const once = toRealNames(t);
      expect(toRealNames(once), t).toBe(once);
    }
  });

  it('ни одно настоящее название не содержит ключ словаря', () => {
    for (const [, real] of REAL_NAME_PAIRS) expect(toRealNames(real), real).toBe(real);
  });

  it('показанное название каталога совпадает с началом настоящего (кроме davinci с размером внутри)', () => {
    const norm = (x: string) => x.toLowerCase().replace(/[\s-]/g, '');
    const bad = RIVAL_MODELS.filter((m) => m.id !== 'gtp-3').filter((m) => {
      const shown = norm(toRealNames(m.gameName).replace(/\s*\(.*$/, ''));
      return !norm(m.realName).startsWith(shown);
    }).map((m) => `${m.gameName} -> ${toRealNames(m.gameName)} | ${m.realName}`);
    expect(bad).toEqual([]);
  });
});
