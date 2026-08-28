// Finding / verdict / fix-result schemas, plus a minimal JSON-Schema-subset
// validator so the CLI can reject malformed findings files deterministically
// (no dependencies — the engine must run on a bare Node install).

export const FINDING = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    file: { type: 'string' },
    line: { type: 'number' },
    detail: { type: 'string' },
    suggestedFix: { type: 'string' },
    rootCause: {
      type: 'string',
      description:
        'Short slug naming the underlying cause (what is wrong, not where) — powers the cross-round finding identity, so keep it stable across re-raises.',
    },
  },
  required: ['title', 'detail'],
};

export const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reviewer: {
      type: 'string',
      description: 'The roster id of the reviewer that produced this report.',
    },
    blockingFindings: { type: 'array', items: FINDING },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Judgement-call / debatable points; never block.',
    },
    consolidations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          detail: {
            type: 'string',
            description:
              'What is generalizable, and which existing call sites would adopt it.',
          },
          targetLib: {
            type: 'string',
            description:
              'The existing lib the code should be consolidated into.',
          },
        },
        required: ['title', 'detail'],
      },
      description:
        'Reuse audit only: generalizable-new-code that belongs in an existing lib as FOLLOW-UP work. Never blocking — the orchestrator files these as tickets, keeping the slice diff small.',
    },
  },
  required: ['reviewer', 'blockingFindings', 'notes'],
};

export const VALIDATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description:
              'The [id] tag of the finding being classified — echo it verbatim.',
          },
          diffCaused: {
            type: 'boolean',
            description:
              'True when the problem is introduced by this diff; false when it is pre-existing or out of scope.',
          },
          confidence: {
            type: 'number',
            description:
              '0–100 confidence the finding is real AND correctly located, after checking the actual code. 90–100 only when traced or reproduced; below 60 means unverified.',
          },
          note: { type: 'string' },
        },
        required: ['id', 'diffCaused', 'confidence'],
      },
    },
  },
  required: ['verdicts'],
};

export const ADJUDICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rulings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          ruling: { type: 'string', enum: ['upheld', 'dismissed'] },
          reason: { type: 'string' },
        },
        required: ['id', 'ruling', 'reason'],
      },
    },
  },
  required: ['rulings'],
};

// Result of an implement or fix pass — what the CLI needs to advance the loop.
// A superset (the old IMPL_SCHEMA's evidence fields) is fine; the CLI reads
// only what it needs and ignores nothing it is given.
export const FIX_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    summary: { type: 'string' },
    committed: { type: 'boolean' },
    head: {
      type: 'string',
      description: 'Output of `git rev-parse HEAD` AFTER committing.',
    },
    testsGreen: {
      type: 'boolean',
      description:
        'True ONLY if tests + lint/typecheck were RUN in this session and seen passing — never assumed.',
    },
    testEvidence: { type: 'string' },
    addedFiles: { type: 'array', items: { type: 'string' } },
    provenance: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string' },
          mirroredFrom: { type: 'string' },
          deviation: { type: 'string' },
        },
        required: ['file'],
      },
    },
    disputed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description:
              'The [id] shown on the finding being disputed — echo it verbatim.',
          },
          title: { type: 'string' },
          evidence: {
            type: 'string',
            description:
              'Concrete proof the finding is factually wrong (file:line, test output, spec text).',
          },
        },
        required: ['title', 'evidence'],
      },
    },
  },
  required: ['summary', 'committed', 'head', 'testsGreen'],
};

export const GUT_CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    observations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          detail: { type: 'string' },
          disposition: { type: 'string', enum: ['route', 'reject', 'block'] },
          routeArea: {
            type: 'string',
            description:
              'route only: the roster reviewer or area best placed to judge it.',
          },
          rootCause: { type: 'string' },
        },
        required: ['title', 'detail', 'disposition'],
      },
    },
    scopeNote: { type: 'string' },
  },
  required: ['observations', 'scopeNote'],
};

// ── Minimal validator ────────────────────────────────────────────────────────
// Supports exactly what the schemas above use: type, properties, required,
// additionalProperties:false, items, enum. Returns a list of error strings;
// empty list = valid.
export function validate(value, schema, path = '$') {
  const errors = [];
  const t = schema.type;
  const typeOf = (v) =>
    Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
  if (t && typeOf(value) !== t) {
    return [`${path}: expected ${t}, got ${typeOf(value)}`];
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return [`${path}: "${value}" not in [${schema.enum.join(', ')}]`];
  }
  if (t === 'object') {
    for (const key of schema.required || [])
      if (!(key in value)) errors.push(`${path}: missing required "${key}"`);
    for (const [key, v] of Object.entries(value)) {
      const sub = (schema.properties || {})[key];
      if (sub) errors.push(...validate(v, sub, `${path}.${key}`));
      else if (schema.additionalProperties === false)
        errors.push(`${path}: unexpected property "${key}"`);
    }
  }
  if (t === 'array' && schema.items) {
    value.forEach((v, i) =>
      errors.push(...validate(v, schema.items, `${path}[${i}]`)),
    );
  }
  return errors;
}
