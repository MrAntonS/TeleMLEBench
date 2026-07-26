export const dataset = {
  canonical_id: 'doi:10.1234/radio-kpi',
  slug: 'radio-kpi',
  name: 'Metro LTE KPI Handover Dataset',
  description: 'Measured LTE cell and session KPIs for supervised handover prediction.',
  kind: 'trainable_ml',
  asset_type: 'static_dataset',
  relevance_status: 'approved',
  publication_status: 'published',
  origin_type: 'measured',
  access_status: 'open',
  download_status: 'done',
  license: 'CC-BY-4.0',
  publisher: 'Example Telecom Research Lab',
  doi: '10.1234/radio-kpi',
  version: '1.0.0',
  last_verified: '2026-07-20T12:00:00Z',
  source_count: 2,
  file_count: 2,
  total_bytes: 3072,
  paper_count: 1,
  reproduction_count: 1,
  verified_run_count: 3,
  release_count: 1,
  task: 'mobility / handover',
  task_families: ['mobility / handover'],
  task_definition: 'Predict handover success from pre-event radio and mobility KPIs.',
  tags: ['LTE', 'KPI', 'handover'],
  url: 'https://doi.org/10.1234/radio-kpi',
  sources: [
    {
      provider: 'Zenodo',
      external_id: 'zenodo-4242',
      landing_url: 'https://zenodo.org/records/4242',
      access_status: 'open'
    },
    {
      provider: 'DataCite',
      external_id: '10.1234/radio-kpi',
      landing_url: 'https://doi.org/10.1234/radio-kpi',
      access_status: 'open'
    }
  ],
  versions: [
    {
      id: 'version-radio-kpi-1',
      version: '1.0.0',
      content_sha256: 'a'.repeat(64)
    }
  ],
  tasks: [
    {
      id: 'task-radio-kpi-handover',
      task_key: 'handover-success',
      task_family: 'mobility / handover',
      recipe_version: 'handover-v1',
      adapter_status: 'ready'
    }
  ],
  releases: [
    {
      id: 'release-radio-kpi-v1',
      release_version: 'telemlebench-v1',
      status: 'published',
      published_at: '2026-07-21T09:30:00Z'
    }
  ],
  papers: [
    {
      paper_id: 'paper-1',
      title: 'Reliable Handover Prediction from LTE KPI Sequences',
      authors: ['Ada Researcher', 'Lin Engineer'],
      publication_year: 2025,
      access_status: 'open',
      url: 'https://arxiv.org/abs/2501.00001',
      evidence: {
        section: 'IV-A Dataset',
        page: 5,
        quote: 'We train and evaluate every model on version 1.0 of the Metro LTE KPI dataset.'
      }
    }
  ]
};

export const files = [
  {
    filename: 'train.csv',
    byte_size: 2048,
    checksum: `sha256:${'b'.repeat(64)}`,
    content_url: 'https://zenodo.org/records/4242/files/train.csv',
    restricted: false
  },
  {
    filename: 'test.csv',
    byte_size: 1024,
    checksum: `sha256:${'c'.repeat(64)}`,
    content_url: 'https://zenodo.org/records/4242/files/test.csv',
    restricted: false
  }
];

export const paper = {
  paper_id: 'paper-1',
  title: 'Reliable Handover Prediction from LTE KPI Sequences',
  authors: ['Ada Researcher', 'Lin Engineer'],
  venue: 'IEEE Transactions on Mobile Computing',
  abstract: 'Measured LTE KPI sequences are used to evaluate leakage-aware handover prediction.',
  publication_date: '2025-01-14',
  publication_year: 2025,
  doi: '10.5555/handover-paper',
  arxiv_id: '2501.00001',
  access_status: 'open',
  url: 'https://arxiv.org/abs/2501.00001',
  versions: [
    {
      id: 'paper-version-1',
      text_sha256: 'd'.repeat(64),
      version_label: 'arXiv v1'
    }
  ],
  dataset_usage: [
    {
      dataset_slug: dataset.slug,
      dataset_name: dataset.name,
      dataset_version_id: 'version-radio-kpi-1',
      evidence: {
        section: 'IV-A Dataset',
        page: 5,
        quote: 'We train and evaluate every model on version 1.0 of the Metro LTE KPI dataset.'
      }
    }
  ]
};

export const reproductionSummary = {
  experiment_id: 'experiment-1',
  paper_title: paper.title,
  dataset_name: dataset.name,
  dataset_slug: dataset.slug,
  task: 'mobility / handover',
  protocol_track: 'paper_only',
  coding_model: 'gpt-5.6-sol',
  outcome: 'comparable_match',
  status: 'complete',
  metric: 'macro F1',
  claimed_score: 0.91,
  reproduced_score: 0.903
};

export const reproduction = {
  id: 'experiment-1',
  status: 'complete',
  outcome: 'comparable_match',
  protocol_track: 'paper_only',
  coding_model: 'gpt-5.6-sol',
  dataset: {
    slug: dataset.slug,
    name: dataset.name,
    version_id: 'version-radio-kpi-1'
  },
  paper: {
    id: paper.paper_id,
    title: paper.title,
    version_id: 'paper-version-1'
  },
  task: {
    id: 'task-radio-kpi-handover',
    task_key: 'handover-success',
    task_family: 'mobility / handover'
  },
  claim: {
    id: 'claim-1',
    metric_name: 'macro F1',
    reported_value: 0.91,
    higher_is_better: true,
    conditions: {
      split: 'paper-defined grouped split',
      test_population: 'held-out cells'
    },
    evidence: {
      section: 'V Results',
      page: 8,
      quote: 'The proposed model obtains a macro F1 score of 0.91.'
    }
  },
  method_facts: [
    {
      category: 'split_policy',
      status: 'explicit',
      value: 'grouped by cell',
      evidence: {
        section: 'IV-B Protocol',
        page: 6,
        quote: 'Cells are disjoint across training and test folds.'
      }
    },
    {
      category: 'early_stopping_patience',
      status: 'missing',
      value: 'Not reported'
    }
  ],
  score_summary: {
    run_count: 3,
    verified_run_count: 3,
    mean: 0.903,
    minimum: 0.899,
    maximum: 0.907,
    population_variance: 0.0000107
  },
  attempts: [
    {
      implementation_index: 1,
      status: 'complete',
      repair_count: 1,
      runs: [
        {
          training_seed: 42,
          outcome: 'comparable_match',
          metric_value: 0.903,
          server_verified: true,
          bundle_sha256: 'e'.repeat(64)
        },
        {
          training_seed: 123,
          outcome: 'comparable_match',
          metric_value: 0.899,
          server_verified: true,
          bundle_sha256: 'f'.repeat(64)
        },
        {
          training_seed: 2026,
          outcome: 'comparable_match',
          metric_value: 0.907,
          server_verified: true,
          bundle_sha256: '1'.repeat(64)
        }
      ]
    }
  ],
  controls: [
    {
      control_type: 'known_good_harness',
      status: 'passed',
      outcome: 'passed',
      bundle_sha256: '2'.repeat(64)
    }
  ],
  cohort_manifest: {
    prompt_contract: 'paper-only-v1',
    coding_model: 'gpt-5.6-sol',
    reasoning_effort: 'medium',
    implementation_count: 3,
    training_seeds: [42, 123, 2026],
    maximum_repairs: 2
  }
};

export const coverage = {
  registry_version: 'telecom-ml-2026.07.3',
  counts: {
    discovered: 96,
    approved_static_ml: 1,
    published: 1,
    paper_linked: 1,
    verified_reproductions: 1
  },
  sync: {
    terminal: 14,
    total: 15
  }
};

export const sources = {
  items: [
    {
      provider: 'Zenodo',
      status: 'complete',
      records_seen: 42,
      records_kept: 8,
      last_sync: '2026-07-20T12:00:00Z',
      authenticated: false
    },
    {
      provider: 'IEEE DataPort',
      status: 'waived_gated',
      records_seen: 12,
      records_kept: 12,
      last_sync: '2026-07-19T12:00:00Z',
      authenticated: false
    }
  ]
};

export const releaseManifest = {
  release_id: 'release-radio-kpi-v1',
  release_version: 'telemlebench-v1',
  split: {
    ratios: [0.7, 0.15, 0.15],
    seed: 42,
    leakage_policy: 'group'
  },
  files: [
    {
      path: 'train/features.parquet',
      sha256: '3'.repeat(64)
    },
    {
      path: 'validation/features.parquet',
      sha256: '4'.repeat(64)
    },
    {
      path: 'test/features.parquet',
      sha256: '5'.repeat(64)
    }
  ]
};
