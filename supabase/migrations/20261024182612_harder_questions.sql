-- Harder questions (owner, 24 Oct 2026: "The questions are too way easy"). Everything one level up (level 1 asks what
-- level 2 used to, and so on, capped at 3); generated maths, sequences, counting and memory made genuinely harder at
-- each level; the bank picks questions of the level asked first (not anything easier); the easy formats (odd one out,
-- the fruit memory game) only below the top level.

-- Count one fruit among similar ones, more of them, higher levels.
create or replace function public.count_question(p_level integer)
returns jsonb language plpgsql set search_path = '' as $$
declare
  pool text[] := array['🥭', '🍊', '🍑', '🌶', '🍅', '🥥', '🍌', '🍍', '🍋'];
  target text;
  others text[];
  n integer;
  total integer;
  items text[] := '{}';
begin
  target := pool[1 + floor(random() * array_length(pool, 1))::integer];
  others := array(select x from unnest(pool) x where x <> target order by random() limit least(2 + p_level, 4));
  n := case p_level when 1 then 5 + floor(random() * 5) when 2 then 6 + floor(random() * 6) else 8 + floor(random() * 6) end;
  total := case p_level when 1 then 14 + floor(random() * 5) when 2 then 18 + floor(random() * 5) else 22 + floor(random() * 5) end;
  for i in 1 .. n loop
    items := items || target;
  end loop;
  for i in 1 .. total - n loop
    items := items || others[1 + floor(random() * array_length(others, 1))::integer];
  end loop;
  return public.build_question('How many ' || target || ' do you see?', n::text,
           array(select x::text from unnest(array[n - 1, n + 1, n + 2, n - 2]) x where x > 0 order by random() limit 3))
         || jsonb_build_object('show', (select string_agg(x, ' ' order by random()) from unnest(items) x));
end;
$$;

-- Remember a row of numbers for 3 seconds: more of them, look-alikes, three digits at the top level.
create or replace function public.memory_number_question(p_level integer)
returns jsonb language plpgsql set search_path = '' as $$
declare
  nums integer[] := '{}';
  v integer;
  slot integer;
  base integer := 10 + floor(random() * 80)::integer;
  how_many integer := case when p_level = 1 then 5 else 6 end;
begin
  while coalesce(array_length(nums, 1), 0) < how_many loop
    v := case p_level
      when 1 then 10 + floor(random() * 90)::integer
      -- look-alikes: the same tens, or the digits swapped
      when 2 then case when random() < 0.5 then (base / 10) * 10 + floor(random() * 10)::integer else (base % 10) * 10 + floor(random() * 10)::integer end
      else 100 + floor(random() * 900)::integer end;
    if v >= 10 and not (v = any (nums)) then
      nums := nums || v;
    end if;
  end loop;
  slot := 1 + floor(random() * how_many)::integer;
  return public.build_question('Which number came ' || (array['first', 'second', 'third', 'fourth', 'fifth', 'sixth'])[slot] || '?', nums[slot]::text,
           array(select x::text from unnest(nums) x where x <> nums[slot] order by random() limit 3))
         || jsonb_build_object('show', array_to_string(nums, '   '), 'showSeconds', 3);
end;
$$;

create or replace function public.make_classic_question(p_category text, p_difficulty integer, p_used bigint[] default '{}'::bigint[])
returns jsonb language plpgsql set search_path = '' as $$
declare
  a int; b int; c int; ans bigint; seq bigint[]; step int; i int; r double precision := random();
  q public.trial_questions%rowtype;
  uid uuid := auth.uid();
  spread int := (array[1, 2, 10])[1 + floor(random() * 3)::integer]; -- wrong answers close, or a digit off
begin
  if p_category = 'maths' then
    if p_difficulty <= 1 then
      if r < 0.5 then
        a := 12 + floor(random() * 18); b := 3 + floor(random() * 7);
        return public.build_question(a || ' × ' || b || ' = ?', (a * b)::text, public.near_numbers(a * b, spread));
      end if;
      a := 100 + floor(random() * 400); b := 100 + floor(random() * 400); c := 20 + floor(random() * 80);
      return public.build_question(a || ' + ' || b || ' − ' || c || ' = ?', (a + b - c)::text, public.near_numbers(a + b - c, spread));
    elsif p_difficulty = 2 then
      if r < 0.6 then
        a := 13 + floor(random() * 27); b := 11 + floor(random() * 9);
        return public.build_question(a || ' × ' || b || ' = ?', (a * b)::text, public.near_numbers(a * b, spread));
      end if;
      a := (array[5, 15, 20, 25, 30, 40, 75])[1 + floor(random() * 7)::integer]; b := 20 * (3 + floor(random() * 40));
      return public.build_question(a || '% of ' || b || ' = ?', (a * b / 100)::text, public.near_numbers(a * b / 100, greatest(1, spread)));
    end if;
    if r < 0.45 then
      a := 12 + floor(random() * 18); b := 12 + floor(random() * 18); c := 50 + floor(random() * 150);
      return public.build_question(a || ' × ' || b || ' − ' || c || ' = ?', (a * b - c)::text, public.near_numbers(a * b - c, spread));
    elsif r < 0.75 then
      a := 13 + floor(random() * 17);
      return public.build_question('√' || (a * a) || ' = ?', a::text, public.near_numbers(a, 1));
    end if;
    a := 11 + floor(random() * 15); b := 10 + floor(random() * 90);
    return public.build_question(a || '² + ' || b || ' = ?', (a * a + b)::text, public.near_numbers(a * a + b, spread));
  end if;

  if p_category = 'sequences' then
    a := 2 + floor(random() * 20);
    step := 3 + floor(random() * 9);
    seq := array[a];
    for i in 2..5 loop
      seq := seq || case
        when p_difficulty <= 1 and r < 0.5 then seq[i - 1] + step * 3                      -- big steps: 7, 28, 49, 70, …
        when p_difficulty <= 1 then seq[i - 1] * 3 - (step % 4)                          -- ×3: 4, 11, 32, 95, …
        when p_difficulty = 2 and r < 0.5 then (a + i - 1) * (a + i - 1)                  -- squares: 49, 64, 81, 100, …
        when p_difficulty = 2 then seq[i - 1] + coalesce(seq[i - 2], step)               -- each the sum of the two before
        when r < 0.5 then seq[i - 1] + (i - 1) * (i - 1) * (step % 5 + 1)                 -- gaps grow as squares
        else case when i % 2 = 0 then seq[i - 1] + step * 4 else seq[i - 1] - step end    -- two moves, taking turns
      end;
    end loop;
    ans := seq[5];
    return public.build_question(
      'What comes next? ' || array_to_string(seq[1:4], ', ') || ', …',
      ans::text,
      public.near_numbers(ans, greatest(1, step / 2)));
  end if;

  -- From the bank, not repeating a question in this trial: the level asked first, then the ones this player hasn't
  -- seen, then the ones seen longest ago.
  select t.* into q from public.trial_questions t
    left join public.questions_seen s on s.question_id = t.id and s.user_id = uid
   where t.category = p_category and t.difficulty <= p_difficulty and not (t.id = any (p_used))
   order by (t.difficulty = p_difficulty) desc, s.seen_at nulls first, random() limit 1;
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

create or replace function public.make_question(p_category text, p_difficulty integer, p_used bigint[] default '{}'::bigint[])
returns jsonb language plpgsql set search_path = '' as $$
declare
  r double precision := random();
  d integer := least(3, greatest(1, coalesce(p_difficulty, 1)) + 1); -- one level up: the old level 1 was too easy
begin
  if p_category = 'maths' then
    if r < 0.25 then
      return public.count_question(d);
    elsif r < 0.45 then
      return public.memory_number_question(d);
    end if;
  elsif p_category = 'sequences' then
    if r < 0.35 then
      return public.memory_number_question(d);
    end if;
  elsif p_category = 'general' then
    if d < 3 and r < 0.15 then
      return public.memory_question();
    elsif d < 3 and r < 0.3 then
      return public.oddone_question(false);
    end if;
  elsif p_category = 'nigeria' then
    if r < 0.2 then
      return public.scramble_question();
    elsif d < 3 and r < 0.35 then
      return public.oddone_question(true);
    end if;
  end if;
  return public.make_classic_question(p_category, d, p_used);
end;
$$;

revoke execute on function public.count_question(integer), public.memory_number_question(integer) from public, anon, authenticated;
