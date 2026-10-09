-- Replace sample photo 3 (jumping kids) with the autumn family photo.
update seasons set
  draft = case when draft->'photos'->2->>'url' = '/sample-photos/mini-3-jumping-kids.jpg'
    then jsonb_set(draft, '{photos,2}', '{"url":"/sample-photos/mini-3-autumn-family.jpg","alt":"Sample photo: a family of four in autumn clothes standing arm in arm in front of orange and gold fall trees"}'::jsonb) else draft end,
  published = case when published is not null and published->'photos'->2->>'url' = '/sample-photos/mini-3-jumping-kids.jpg'
    then jsonb_set(published, '{photos,2}', '{"url":"/sample-photos/mini-3-autumn-family.jpg","alt":"Sample photo: a family of four in autumn clothes standing arm in arm in front of orange and gold fall trees"}'::jsonb) else published end;
