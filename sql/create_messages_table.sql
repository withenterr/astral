create table messages (
  id bigint generated always as identity primary key,
  username text,
  message text,
  created_at timestamp default now()
);
