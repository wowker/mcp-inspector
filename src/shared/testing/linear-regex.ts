interface State {
  matches: (character: string) => boolean;
  skippable: boolean;
  looping: boolean;
}

const MAX_PATTERN_LENGTH = 512;
const MAX_INPUT_LENGTH = 8_192;
const MAX_STATES = 512;
const MAX_BOUNDED_REPETITION = 100;

export class UnsupportedRegexError extends Error {}

function literalMatcher(literal: string, caseSensitive: boolean): (character: string) => boolean {
  const expected = caseSensitive ? literal : literal.toLocaleLowerCase();
  return (character) => (caseSensitive ? character : character.toLocaleLowerCase()) === expected;
}

function escapeMatcher(value: string, caseSensitive: boolean): (character: string) => boolean {
  switch (value) {
    case "d": return (character) => /[0-9]/.test(character);
    case "D": return (character) => !/[0-9]/.test(character);
    case "s": return (character) => /[\t\n\v\f\r ]/.test(character);
    case "S": return (character) => !/[\t\n\v\f\r ]/.test(character);
    case "w": return (character) => /[A-Za-z0-9_]/.test(character);
    case "W": return (character) => !/[A-Za-z0-9_]/.test(character);
    case "n": return literalMatcher("\n", caseSensitive);
    case "r": return literalMatcher("\r", caseSensitive);
    case "t": return literalMatcher("\t", caseSensitive);
    default:
      if (/[1-9]/.test(value)) throw new UnsupportedRegexError("Regex backreferences are not supported");
      return literalMatcher(value, caseSensitive);
  }
}

function classMatcher(source: string, caseSensitive: boolean): (character: string) => boolean {
  let cursor = 0;
  const negated = source.startsWith("^");
  if (negated) cursor += 1;
  const matchers: Array<(character: string) => boolean> = [];
  while (cursor < source.length) {
    let first = source[cursor++]!;
    let firstMatcher: (character: string) => boolean;
    if (first === "\\") {
      if (cursor >= source.length) throw new UnsupportedRegexError("Regex character class escape is incomplete");
      first = source[cursor++]!;
      firstMatcher = escapeMatcher(first, caseSensitive);
    } else {
      firstMatcher = literalMatcher(first, caseSensitive);
    }
    if (cursor + 1 < source.length && source[cursor] === "-" && source[cursor + 1] !== "]") {
      cursor += 1;
      let last = source[cursor++]!;
      if (last === "\\") {
        if (cursor >= source.length) throw new UnsupportedRegexError("Regex range escape is incomplete");
        last = source[cursor++]!;
      }
      const lower = (caseSensitive ? first : first.toLocaleLowerCase()).codePointAt(0)!;
      const upper = (caseSensitive ? last : last.toLocaleLowerCase()).codePointAt(0)!;
      if (lower > upper) throw new UnsupportedRegexError("Regex character range is invalid");
      matchers.push((character) => {
        const point = (caseSensitive ? character : character.toLocaleLowerCase()).codePointAt(0)!;
        return point >= lower && point <= upper;
      });
    } else {
      matchers.push(firstMatcher);
    }
  }
  if (matchers.length === 0) throw new UnsupportedRegexError("Regex character class is empty");
  return (character) => negated !== matchers.some((matcher) => matcher(character));
}

function addState(states: State[], matches: State["matches"], skippable: boolean, looping: boolean): void {
  states.push({ matches, skippable, looping });
  if (states.length > MAX_STATES) throw new UnsupportedRegexError("Regex expands beyond the state limit");
}

function addQuantifiedStates(
  states: State[],
  matches: State["matches"],
  minimum: number,
  maximum: number | null,
): void {
  if (minimum > MAX_BOUNDED_REPETITION || (maximum !== null && maximum > MAX_BOUNDED_REPETITION)) {
    throw new UnsupportedRegexError("Regex repetition exceeds the supported limit");
  }
  for (let index = 0; index < minimum; index += 1) addState(states, matches, false, false);
  if (maximum === null) addState(states, matches, true, true);
  else for (let index = minimum; index < maximum; index += 1) addState(states, matches, true, false);
}

function compile(pattern: string, caseSensitive: boolean): {
  states: State[];
  anchoredStart: boolean;
  anchoredEnd: boolean;
} {
  if (pattern.length > MAX_PATTERN_LENGTH) throw new UnsupportedRegexError("Regex pattern exceeds the length limit");
  let cursor = 0;
  const anchoredStart = pattern.startsWith("^");
  if (anchoredStart) cursor += 1;
  const anchoredEnd = pattern.endsWith("$") && !pattern.endsWith("\\$");
  const end = anchoredEnd ? pattern.length - 1 : pattern.length;
  const states: State[] = [];
  while (cursor < end) {
    const token = pattern[cursor++]!;
    let matches: State["matches"];
    if (token === "\\") {
      if (cursor >= end) throw new UnsupportedRegexError("Regex escape is incomplete");
      matches = escapeMatcher(pattern[cursor++]!, caseSensitive);
    } else if (token === ".") {
      matches = (character) => character !== "\n" && character !== "\r";
    } else if (token === "[") {
      const start = cursor;
      let escaped = false;
      while (cursor < end) {
        const character = pattern[cursor]!;
        if (!escaped && character === "]") break;
        escaped = !escaped && character === "\\";
        if (character !== "\\") escaped = false;
        cursor += 1;
      }
      if (cursor >= end) throw new UnsupportedRegexError("Regex character class is unclosed");
      matches = classMatcher(pattern.slice(start, cursor), caseSensitive);
      cursor += 1;
    } else if ("()|".includes(token) || token === "^" || token === "$") {
      throw new UnsupportedRegexError("Regex groups, alternation, and internal anchors are not supported");
    } else if ("*+?{".includes(token)) {
      throw new UnsupportedRegexError("Regex quantifier has no preceding value");
    } else {
      matches = literalMatcher(token, caseSensitive);
    }

    if (cursor >= end || !"*+?{".includes(pattern[cursor]!)) {
      addState(states, matches, false, false);
      continue;
    }
    const quantifier = pattern[cursor++]!;
    if (quantifier === "*") addQuantifiedStates(states, matches, 0, null);
    else if (quantifier === "+") addQuantifiedStates(states, matches, 1, null);
    else if (quantifier === "?") addQuantifiedStates(states, matches, 0, 1);
    else {
      const close = pattern.indexOf("}", cursor);
      if (close === -1 || close >= end) throw new UnsupportedRegexError("Regex repetition is unclosed");
      const range = pattern.slice(cursor, close);
      const parsed = /^(\d+)(?:,(\d*)?)?$/.exec(range);
      if (parsed === null) throw new UnsupportedRegexError("Regex repetition is invalid");
      const minimum = Number(parsed[1]);
      const maximum = !range.includes(",") ? minimum : parsed[2] === "" ? null : Number(parsed[2]);
      if (maximum !== null && maximum < minimum) throw new UnsupportedRegexError("Regex repetition range is invalid");
      addQuantifiedStates(states, matches, minimum, maximum);
      cursor = close + 1;
    }
  }
  return { states, anchoredStart, anchoredEnd };
}

function closure(states: State[], positions: Set<number>): Set<number> {
  const closed = new Set(positions);
  const queue = [...positions];
  while (queue.length > 0) {
    const position = queue.pop()!;
    if (position < states.length && states[position]!.skippable && !closed.has(position + 1)) {
      closed.add(position + 1);
      queue.push(position + 1);
    }
  }
  return closed;
}

export function linearRegexTest(pattern: string, input: string, caseSensitive = true): boolean {
  if (input.length > MAX_INPUT_LENGTH) throw new UnsupportedRegexError("Regex input exceeds the length limit");
  const { states, anchoredStart, anchoredEnd } = compile(pattern, caseSensitive);
  let active = closure(states, new Set([0]));
  if (active.has(states.length) && (!anchoredEnd || input.length === 0)) return true;
  const characters = [...input];
  for (let offset = 0; offset < characters.length; offset += 1) {
    if (!anchoredStart) active = closure(states, new Set([...active, 0]));
    const next = new Set<number>();
    for (const position of active) {
      const state = states[position];
      if (state === undefined || !state.matches(characters[offset]!)) continue;
      next.add(state.looping ? position : position + 1);
    }
    active = closure(states, next);
    if (active.has(states.length) && (!anchoredEnd || offset === characters.length - 1)) return true;
  }
  if (!anchoredStart) active = closure(states, new Set([...active, 0]));
  return active.has(states.length);
}
