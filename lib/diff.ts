export type DiffSegment = {
  text: string;
  changed: boolean;
};

// Character-level diff of `value` against `reference`.
// Returns segments where `changed` marks characters of `value` that are not
// part of the longest common subsequence (i.e. the characters that differ).
export function diffChars(value: string, reference: string): DiffSegment[] {
  const n = value.length;
  const m = reference.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        value[i] === reference[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  const push = (text: string, changed: boolean) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.changed === changed) {
      last.text += text;
    } else {
      segments.push({ text, changed });
    }
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (value[i] === reference[j]) {
      push(value[i], false);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(value[i], true);
      i++;
    } else {
      j++;
    }
  }
  while (i < n) {
    push(value[i], true);
    i++;
  }

  return segments;
}
