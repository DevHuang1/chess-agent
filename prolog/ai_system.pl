% =============================================================================
% SENTIO — Emotion-Adaptive Chess AI
% Prolog knowledge base modelling how the system works
% =============================================================================
% Load with:  swipl -s prolog/ai_system.pl
% Then query: ?- explain.
% =============================================================================

% ---------------------------------------------------------------------------
% 1. FACTS: Emotion → Strength Profiles
% ---------------------------------------------------------------------------
% Each emotion maps to a Stockfish configuration:
%   profile(Emotion, Depth, SkillLevel, Elo)

profile(stressed,    1,  1, 1320).
profile(frustrated,  2,  3, 1320).
profile(calm,        4,  6, 1600).
profile(neutral,     6, 10, 2000).
profile(focused,     8, 15, 2600).
profile(confident,  10, 20, 3190).

% ---------------------------------------------------------------------------
% 2. FACTS: Facial Expression → Emotion Mapping
% ---------------------------------------------------------------------------
% face-api.js classifies 7 raw expressions; these map to 6 game emotions.

expression(happy,     confident).
expression(neutral_x, neutral).     % neutral_x to avoid clash with profile/4
expression(sad,       frustrated).
expression(angry,     frustrated).
expression(fearful,   stressed).
expression(surprised, focused).
expression(disgusted, stressed).

% ---------------------------------------------------------------------------
% 3. FACTS: Bot Trash-Talk Pools
% ---------------------------------------------------------------------------
% Canned remarks keyed to emotion, split by event type.

taunt(confident, check,   "You see the threats. Whether you can stop them is another matter.").
taunt(confident, check,   "Confidence looks good on you. Shame it won't save your king.").
taunt(confident, capture, "Piece gone. Like your confidence in a moment.").
taunt(confident, capture, "Material is a language you're still learning to read.").

taunt(neutral, check,     "A check. Respond appropriately.").
taunt(neutral, capture,   "Piece captured. The balance shifts.").

taunt(frustrated, check,  "Your frustration is starting to show in your play.").
taunt(frustrated, capture,"That mistake will only compound your frustration.").

taunt(stressed, check,    "Take a breath. The check can wait.").
taunt(stressed, capture,  "One piece at a time. You can recover.").

taunt(calm, check,        "Let's see how calm you stay under pressure.").
taunt(calm, capture,      "A fair trade, calmly executed.").

taunt(focused, check,     "You saw that coming. Now find the follow-up.").
taunt(focused, capture,   "Calculated. Expected.").

% ---------------------------------------------------------------------------
% 4. FACTS: Architecture Components
% ---------------------------------------------------------------------------

component(browser,  "React 19 + chess.js + react-chessboard + face-api.js").
component(webcam,   "navigator.mediaDevices.getUserMedia → TinyFaceDetector → FaceExpressionNet").
component(api,      "Next.js App Router: /api/bot-move (proxy) + /api/coach (LLM + fallback)").
component(backend,  "Python FastAPI on :8000: resolves emotion → profile → Stockfish instance").
component(engine,   "Stockfish binary: negamax + alpha-beta pruning + iterative deepening").
component(llm,      "LM Studio on :1234: local LLM (qwen/qwen3.5-9b) for coaching").

connection(browser, api,     "HTTP: POST /api/bot-move {fen, emotion} and POST /api/coach {fen, emotion, question}").
connection(api,     backend, "HTTP proxy: forwards bot-move requests to Python FastAPI").
connection(backend, engine,  "python-stockfish bindings, isolated instance per request").
connection(api,     llm,     "HTTP POST to /v1/chat/completions with FEN + emotion + question").

% ---------------------------------------------------------------------------
% 5. RULES: System Behaviour
% ---------------------------------------------------------------------------

% Resolve the full engine profile for a given emotion.
resolve(Emotion, depth(Depth), skill(Skill), elo(Elo)) :-
    profile(Emotion, Depth, Skill, Elo).

% Determine which emotion a detected facial expression maps to.
express(Expr, Emotion) :-
    expression(Expr, Emotion).

% Smoothing: majority vote over the last N detections.
% smooth(+Detections, -Emotion)
smooth(Detections, Emotion) :-
    findall(E, (member(D, Detections), expression(D, E)), Emotions),
    most_common(Emotions, Emotion).

most_common(List, MostCommon) :-
    msort(List, Sorted),
    count_runs(Sorted, Counts),
    sort(2, @>=, Counts, SortedCounts),  % sort by count descending
    SortedCounts = [MostCommon-_|_].

count_runs([], []).
count_runs([X|Xs], [X-Count|Rest]) :-
    run(X, Xs, Count, Remaining),
    count_runs(Remaining, Rest).

run(X, [X|Xs], Count, Remaining) :-
    !,
    run(X, Xs, Count1, Remaining),
    Count is Count1 + 1.
run(_, Rest, 1, Rest).

% Query: given a detected expression, what engine should be used?
% ?- engine_for_expression(sad, Depth, Skill, Elo).
engine_for_expression(Expr, Depth, Skill, Elo) :-
    expression(Expr, Emotion),
    profile(Emotion, Depth, Skill, Elo).

% Query: explain the full pipeline for a given expression.
% ?- pipeline(sad, Report).
pipeline(Expr, Report) :-
    expression(Expr, Emotion),
    profile(Emotion, Depth, Skill, Elo),
    format(atom(Report),
        'Expression: ~w → Emotion: ~w\nStockfish: depth=~d, skill=~d, ELO=~d\n',
        [Expr, Emotion, Depth, Skill, Elo]).

% ---------------------------------------------------------------------------
% 6. INTERACTIVE: Explain the entire system
% ---------------------------------------------------------------------------

explain :-
    writeln('╔══════════════════════════════════════════════════════════════╗'),
    writeln('║              SENTIO — Emotion-Adaptive Chess AI              ║'),
    writeln('╚══════════════════════════════════════════════════════════════╝'),
    nl,
    writeln('Architecture:'),
    forall(component(Name, Desc),
           format('  - ~w: ~w\n', [Name, Desc])),
    nl,
    writeln('Data flow:'),
    forall(connection(From, To, Via),
           format('  ~w → ~w: ~w\n', [From, To, Via])),
    nl,
    writeln('Strength profiles:'),
    forall(profile(Emo, D, S, E),
           format('  ~w → depth=~d, skill=~d, ELO=~d\n', [Emo, D, S, E])),
    nl,
    writeln('Expression → emotion mapping:'),
    forall(expression(Expr, Emo),
           format('  ~w → ~w\n', [Expr, Emo])),
    nl,
    writeln('Sample queries:'),
    writeln('  ?- engine_for_expression(sad, D, S, E).'),
    writeln('  ?- pipeline(fearful, R).'),
    writeln('  ?- smooth([sad, angry, neutral_x], E).'),
    nl.
