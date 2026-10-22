-- Fresh questions (owner, 21 Oct 2026: "we do not keep repeating questions, riddles, that quiz"). Each player's game
-- remembers which bank questions they've been asked (Key Trials, street sellers' riddles) and which landmark questions,
-- and asks the ones they haven't seen first, then the ones seen longest ago. The bank grows with questions written by
-- Claude (scripts/generate-questions.mts), marked by `source`.

alter table public.trial_questions
  add column if not exists source text not null default 'hand' check (source in ('hand', 'claude')),
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.questions_seen (
  user_id     uuid not null references auth.users (id) on delete cascade,
  question_id bigint not null references public.trial_questions (id) on delete cascade,
  seen_at     timestamptz not null default now(),
  primary key (user_id, question_id)
);
alter table public.questions_seen enable row level security;
revoke all on public.questions_seen from anon, authenticated; -- only through the functions below

create or replace function public.make_classic_question(p_category text, p_difficulty integer, p_used bigint[] default '{}'::bigint[])
returns jsonb language plpgsql set search_path = '' as $$
declare
  a int; b int; c int; ans bigint; seq bigint[]; step int; i int;
  q public.trial_questions%rowtype;
  uid uuid := auth.uid();
begin
  if p_category = 'maths' then
    if p_difficulty = 1 then
      a := 10 + floor(random() * 80); b := 2 + floor(random() * 40);
      if random() < 0.5 then
        return public.build_question(a || ' + ' || b || ' = ?', (a + b)::text, public.near_numbers(a + b, 1 + floor(random() * 2)::int));
      end if;
      return public.build_question((a + b) || ' − ' || b || ' = ?', a::text, public.near_numbers(a, 1 + floor(random() * 2)::int));
    elsif p_difficulty = 2 then
      a := 3 + floor(random() * 10); b := 3 + floor(random() * 10);
      return public.build_question(a || ' × ' || b || ' = ?', (a * b)::text, public.near_numbers(a * b, a));
    end if;
    a := 3 + floor(random() * 10); b := 3 + floor(random() * 10); c := 5 + floor(random() * 40);
    return public.build_question(a || ' × ' || b || ' + ' || c || ' = ?', (a * b + c)::text, public.near_numbers(a * b + c, 1 + floor(random() * 3)::int * (case when random() < 0.5 then 1 else 10 end)));
  end if;

  if p_category = 'sequences' then
    a := 1 + floor(random() * 20);
    step := 2 + floor(random() * 8);
    seq := array[a];
    for i in 2..5 loop
      seq := seq || case p_difficulty
        when 1 then seq[i - 1] + step                          -- 4, 9, 14, 19, …
        when 2 then seq[i - 1] * 2 + (step % 3)                -- 3, 7, 15, 31, …
        else seq[i - 1] + step * (i - 1)                       -- gaps grow: 5, 8, 14, 23, …
      end;
    end loop;
    ans := seq[5];
    return public.build_question(
      'What comes next? ' || array_to_string(seq[1:4], ', ') || ', …',
      ans::text,
      public.near_numbers(ans, greatest(1, step / 2)));
  end if;

  -- From the bank, not repeating a question in this trial: the ones this player hasn't seen first, then the ones
  -- seen longest ago.
  select t.* into q from public.trial_questions t
    left join public.questions_seen s on s.question_id = t.id and s.user_id = uid
   where t.category = p_category and t.difficulty <= p_difficulty and not (t.id = any (p_used))
   order by s.seen_at nulls first, random() limit 1;
  if not found then
    return public.make_classic_question('maths', p_difficulty);
  end if;
  if uid is not null then
    insert into public.questions_seen (user_id, question_id) values (uid, q.id)
    on conflict (user_id, question_id) do update set seen_at = now();
  end if;
  return public.build_question(q.prompt, q.choices[q.answer + 1], q.choices[1:q.answer] || q.choices[q.answer + 2:])
         || jsonb_build_object('bank_id', q.id);
end;
$$;

-- Check in at a landmark the player is at: a question about it they haven't had (or had longest ago), 20 seconds.
create or replace function public.start_checkin(p_landmark bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  l public.landmarks%rowtype;
  pos public.player_positions%rowtype;
  last_try timestamptz;
  q integer;
  c public.landmark_checkins%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select * into l from public.landmarks where id = p_landmark;
  if l.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, l.lng, l.lat) > l.radius_m then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  select max(asked_at) into last_try from public.landmark_checkins where user_id = uid and landmark_id = l.id;
  if last_try > now() - interval '1 day' then
    return jsonb_build_object('ok', false, 'reason', 'tomorrow', 'nextAt', last_try + interval '1 day');
  end if;
  select n into q from generate_series(0, jsonb_array_length(l.questions) - 1) n
   order by (select max(x.asked_at) from public.landmark_checkins x
              where x.user_id = uid and x.landmark_id = l.id and x.question = n) nulls first, random()
   limit 1;
  insert into public.landmark_checkins (user_id, landmark_id, question, deadline)
  values (uid, l.id, q, now() + interval '20 seconds')
  returning * into c;
  return jsonb_build_object('ok', true, 'checkinId', c.id, 'landmark', l.name,
    'question', l.questions -> q ->> 'q', 'options', l.questions -> q -> 'options',
    'seconds', 20, 'deadline', c.deadline, 'now', now());
end;
$$;
