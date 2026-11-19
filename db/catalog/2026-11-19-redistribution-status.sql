-- Redistribution status from hand license checks of the providers' own pages (2026-11-19).
-- Project records, not legal advice. Mirrors server/lib/releases.ts (descriptor.license).
-- Apply in the Supabase SQL editor (service role). Expected: 6 rows updated.

begin;

alter table public.tmlb_dataset_versions
  add column if not exists license_source_url text,
  add column if not exists license_terms text,
  add column if not exists license_checked_on date;

-- Before: all six are redistribution_status = 'unknown'.
-- If a CHECK constraint rejects 'not_allowed', the catalog's existing equivalent is 'link_only'.

update public.tmlb_dataset_versions set
  license_name = 'CC-BY-4.0',
  license_url = 'https://creativecommons.org/licenses/by/4.0/',
  license_source_url = 'https://veremi-dataset.github.io/veremi/',
  license_terms = 'Attribution required. Zenodo record: https://doi.org/10.5281/zenodo.20081895',
  license_checked_on = '2026-11-19',
  redistribution_status = 'allowed'
where id = 'dsv_a130fc2ac4a437717b45eb35';  -- VeReMi (was: copyright_notice / unknown)

update public.tmlb_dataset_versions set
  license_name = 'CC-BY-4.0',
  license_url = 'https://creativecommons.org/licenses/by/4.0/',
  license_source_url = 'https://veremi-dataset.github.io/veremi-extension/',
  license_terms = 'Attribution required.',
  license_checked_on = '2026-11-19',
  redistribution_status = 'allowed'
where id = 'dsv_b4b70c9e0abb5c1c91dc310f';  -- VeReMi Extension (was: copyright_notice / unknown)

update public.tmlb_dataset_versions set
  license_name = 'CC-BY-4.0',
  license_url = 'https://creativecommons.org/licenses/by/4.0/',
  license_source_url = 'https://doi.org/10.5281/zenodo.13921775',
  license_terms = 'Attribution required.',
  license_checked_on = '2026-11-19',
  redistribution_status = 'allowed'
where id = 'dsv_2b4b6c2f2f46033eaebd4f5e';  -- TopologyBench (was: repository_record / unknown)

update public.tmlb_dataset_versions set
  license_name = 'CC-BY-NC-SA-4.0',
  license_url = 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  license_source_url = 'https://www.deepsig.ai/datasets/',
  license_terms = 'NonCommercial: no commercial use. ShareAlike: adaptations must be distributed under CC BY-NC-SA 4.0. '
               || 'OWL release radioml2016-10a-modulation-classification-v1 is cut from this version.',
  license_checked_on = '2026-11-19',
  redistribution_status = 'allowed'
where id = 'dsv_ebcdc40ddf743d67343b2440';  -- RadioML 2016.10A (was: CC-BY-NC-SA-4.0 / unknown)

update public.tmlb_dataset_versions set
  license_name = 'No license stated (UNB CIC terms)',
  license_url = null,
  license_source_url = 'https://www.unb.ca/cic/datasets/ids-2017.html',
  license_terms = 'No license stated. Provider: "publicly available for researchers"; cite the dataset paper. '
               || '© University of New Brunswick. OWL publishes a split definition only.',
  license_checked_on = '2026-11-19',
  redistribution_status = 'not_allowed'
where id = 'dsv_23647609e257911ae43693c0';  -- CICIDS2017 (was: UNB_CIC_terms / unknown)

update public.tmlb_dataset_versions set
  license_name = 'No license stated (UNB CIC terms)',
  license_url = null,
  license_source_url = 'https://www.unb.ca/cic/datasets/iotdataset-2023.html',
  license_terms = 'No license stated. © University of New Brunswick; cite the dataset paper. '
               || 'OWL publishes a split definition only.',
  license_checked_on = '2026-11-19',
  redistribution_status = 'not_allowed'
where id = 'dsv_a19618cffe36f58e6bb774fe';  -- CICIoT2023 (was: UNB_CIC_terms / unknown)

-- Check: should return the six rows with the new values.
select id, license_name, redistribution_status, license_source_url
from public.tmlb_dataset_versions
where id in ('dsv_a130fc2ac4a437717b45eb35', 'dsv_b4b70c9e0abb5c1c91dc310f', 'dsv_2b4b6c2f2f46033eaebd4f5e',
             'dsv_ebcdc40ddf743d67343b2440', 'dsv_23647609e257911ae43693c0', 'dsv_a19618cffe36f58e6bb774fe');

commit;
