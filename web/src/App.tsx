import { useEffect, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from 'react';
import { api, money, moneyExact, streamChat } from './api';
import { memberPaceSummary } from './memberPace';
import { brand } from '../brand.config';

type Me = { id: string; name: string; role: 'admin' | 'member'; dryRun: boolean; mockExternals: boolean };
type PublicConfig = { appName: string; adminName: string; memberName: string };
type Category = { id: string; name: string; groupName: string; budgetedMilli: number; activityMilli: number; balanceMilli: number; spentMilli: number; pace: number | null };
type DashboardData = { month: string; daysLeft: number; readyToAssignMilli?: number; categories: Category[]; availableCategories: Category[]; hiddenCategoryIds: string[] };
type ChatAnswer = { answer_md: string; chart: any; followups: string[] };
type ChatTurn = { id: number; question: string; answer: ChatAnswer; pending: boolean };
type CategoryDetailData = {
  category: { id: string; name: string; groupName: string };
  month: string;
  summary: { budgetedMilli: number; activityMilli: number; balanceMilli: number };
  transactions: Array<{ id: string; date: string; payeeName: string | null; importPayeeNameOriginal: string | null; accountName: string; memo: string | null; amountMilli: number; cleared: string }>;
};

const accents = ['#c2703a', '#5a8a3a', '#4a6fa5', '#b05a7a', '#8a6f4a', '#7c5a9b', '#3f7f78'];
const accentFor = (value: string) => accents[[...value].reduce((sum, character) => sum + character.charCodeAt(0), 0) % accents.length];
const chartMoney = (value: number, digits = 0) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(value);

function BrandLockup({ className = '' }: { className?: string }) {
  return <span className={`brand-lockup ${className}`.trim()}>
    <img src="/brand/icon.svg" alt="" />
    <span><strong>{brand.name}</strong><small>{brand.tagline}</small></span>
  </span>;
}

function App() {
  const publicPath = window.location.pathname;
  if (publicPath === '/sms-consent') return <SmsConsentPage />;
  if (publicPath === '/privacy') return <LegalPage kind="privacy" />;
  if (publicPath === '/terms') return <LegalPage kind="terms" />;
  const [me, setMe] = useState<Me | null>(null);
  const [authMissing, setAuthMissing] = useState(false);
  useEffect(() => { api<Me>('/api/me').then(setMe).catch(() => setAuthMissing(true)); }, []);
  if (authMissing) return <SignIn />;
  if (!me) return <Loading label="Opening your budget" />;
  return <Shell me={me} />;
}


function SmsConsentPage() {
  return <main className="legal-page consent-page">
    <header><a href="/" aria-label={`${brand.name} home`}><BrandLockup /></a><nav><a href="/terms">Terms</a><a href="/privacy">Privacy</a></nav></header>
    <article>
      <p className="legal-eyebrow">TALLY AUTHENTICATION SMS</p>
      <h1>How text sign-in consent works</h1>
      <p className="legal-updated">Public verification page · Effective August 4, 2026</p>
      <p>{brand.name} is a private household budgeting companion operated by {brand.operatorName}. Its authentication campaign sends a one-time sign-in link only when one of the two pre-registered household members explicitly requests it.</p>
      <section className="consent-proof" aria-label={`${brand.name} SMS opt-in example`}>
        <span className="consent-proof-label">LIVE OPT-IN LANGUAGE</span>
        <strong>Text [Name] a sign-in link</strong>
        <label><input type="checkbox" disabled /> <span>I agree to receive one {brand.name} authentication text at the registered number for this profile.</span></label>
        <p>Message frequency: one message per request, limited to three requests per hour. Message and data rates may apply. Reply STOP to opt out or HELP for help.</p>
      </section>
      <h2>Exact opt-in path</h2>
      <ol>
        <li>The registered member visits the public <a href="/">{brand.name} sign-in page</a> and selects their own named profile.</li>
        <li>They check the unchecked SMS consent box shown above. No consent is preselected.</li>
        <li>They press “Text [Name] a sign-in link,” requesting one authentication message to the number already registered for that profile.</li>
      </ol>
      <h2>SMS is optional</h2>
      <p>The household PIN remains available directly below the text option. A member can sign in without checking the SMS box or receiving a text. {brand.name} does not use this flow for marketing, promotions, purchased lists, or third-party messages.</p>
      <h2>Program disclosures</h2>
      <p>Each request sends one message. Requests are limited to three per hour. Message and data rates may apply. Reply STOP to opt out, START to resume, or HELP for help. Read the <a href="/terms">Terms and Conditions</a> and <a href="/privacy">Privacy Policy</a>.</p>
      <p><a className="consent-live-link" href="/">View the live sign-in flow →</a></p>
    </article>
    <footer><BrandLockup /><span>Authentication texts only when requested.</span></footer>
  </main>;
}

function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const isPrivacy = kind === 'privacy';
  return <main className="legal-page">
    <header><a href="/" aria-label={`${brand.name} home`}><BrandLockup /></a><nav><a className={isPrivacy ? 'active' : ''} href="/privacy">Privacy</a><a className={!isPrivacy ? 'active' : ''} href="/terms">Terms</a></nav></header>
    <article>
      <p className="legal-eyebrow">TALLY FOR YNAB</p>
      <h1>{isPrivacy ? 'Privacy Policy' : 'Terms and Conditions'}</h1>
      <p className="legal-updated">Effective {brand.effectiveDate}</p>
      {isPrivacy ? <>
        <p>{brand.name} is a private household budgeting companion operated by {brand.operatorName}. It connects to a household YNAB account and helps the two registered household members review budget information, categorize transactions, receive account notifications, and request secure sign-in links.</p>
        <h2>Information we process</h2>
        <p>We process the names and phone numbers of registered household members, sign-in and security events, message delivery records, and budgeting data retrieved from the connected YNAB account. We use this information only to operate, secure, support, and improve {brand.name} for its registered users.</p>
        <h2>SMS and mobile information</h2>
        <p>Mobile information, including phone numbers and SMS consent records, is used only to deliver requested one-time sign-in links and optional household budget notifications. Authentication messages are sent only when requested, with a limit of three requests per hour; optional notification frequency varies according to the settings chosen by the registered household member. Message and data rates may apply. Mobile information will not be sold, rented, or shared with third parties or affiliates for marketing or promotional purposes. We may share information with service providers such as Twilio only as necessary to deliver and secure these messages.</p>
        <h2>Storage and security</h2>
        <p>We use reasonable safeguards designed to protect household data. Access is limited to registered household members. No method of electronic storage or transmission is completely secure, so absolute security cannot be guaranteed.</p>
        <h2>Your choices</h2>
        <p>You may opt out of SMS at any time by replying STOP. Reply START to resume or HELP for help. You may also ask us to correct or delete your phone number or message records by contacting us.</p>
        <h2>Contact</h2>
        <p>Questions or privacy requests may be sent to <a href={`mailto:${brand.contactEmail}`}>{brand.contactEmail}</a>.</p>
      </> : <>
        <p>These terms govern use of {brand.name}, a private household budgeting companion operated by {brand.operatorName}. By using {brand.name}, you agree to these terms.</p>
        <h2>Household access</h2>
        <p>{brand.name} is available only to registered household members. Keep sign-in links and PINs private, and notify the operator if you believe access has been compromised.</p>
        <h2>SMS program</h2>
        <p>Registered users may request one-time sign-in links and may choose to receive household budget reminders or account notifications. Message frequency varies based on user requests and enabled notifications. Message and data rates may apply. Carriers are not liable for delayed or undelivered messages.</p>
        <p>Consent to receive SMS is not a condition of purchase. Reply STOP to opt out, START to resume, or HELP for help. You may also contact <a href={`mailto:${brand.contactEmail}`}>{brand.contactEmail}</a>. Supported carriers may change.</p>
        <h2>Acceptable use</h2>
        <p>Do not attempt to access another person’s data, interfere with the service, misuse messaging features, or use {brand.name} for unlawful purposes.</p>
        <h2>Budget information</h2>
        <p>{brand.name} provides informational summaries based on connected account data. It does not provide financial, tax, or legal advice. Verify important information in YNAB or with the appropriate professional before making financial decisions.</p>
        <h2>Availability and changes</h2>
        <p>The service may be changed, suspended, or discontinued. These terms may be updated as the service evolves; the effective date above will be revised when that happens.</p>
        <h2>Third-party services</h2>
        <p>{brand.name} relies on third-party services, including YNAB and Twilio, which are governed by their own terms and policies. {brand.name} is an independent companion and is not endorsed by or affiliated with YNAB.</p>
      </>}
    </article>
    <footer><BrandLockup /><span>Private household budgeting support.</span></footer>
  </main>;
}

function Shell({ me }: { me: Me }) {
  const path = window.location.pathname;
  const categoryMatch = path.match(/^\/category\/([^/]+)$/);
  return <div className="app-shell">
    <aside className="sidebar">
      <a href="/" className="brand" aria-label={`${brand.name} home`}><BrandLockup /></a>
      <nav aria-label="Primary navigation">
        <Nav href="/" path={path} active={path === '/' || Boolean(categoryMatch)} icon="⌂">Overview</Nav>
        <Nav href="/queue" path={path} icon="?">Queue</Nav>
        <Nav href="/chat" path={path} icon="✦">Ask</Nav>
        {me.role === 'admin' && <Nav href="/settings" path={path} icon="✓">Essentials</Nav>}
        {me.role === 'admin' && <Nav href="/admin" path={path} icon="••">System</Nav>}
      </nav>
      <div className="sidebar-account"><span className="avatar">{me.name.slice(0, 1).toUpperCase()}</span><span><strong>{me.name}</strong><small>{me.role === 'admin' ? 'Household admin' : 'Household member'}</small></span></div>
      <div className="sidebar-status"><span className={me.dryRun ? 'status-dot muted-dot' : 'status-dot'} />{me.dryRun ? 'No live changes' : 'YNAB connected'}</div>
    </aside>
    <main className="main-content">
      <div className="mobile-account"><div><strong>{me.name}</strong><small>Household budget</small></div><SyncChip me={me} /></div>
      {categoryMatch ? <CategoryDetail id={decodeURIComponent(categoryMatch[1])} /> : path === '/queue' ? <Queue /> : path === '/chat' ? <Chat /> : path === '/settings' && me.role === 'admin' ? <Settings /> : path === '/admin' && me.role === 'admin' ? <Admin /> : <Dashboard me={me} />}
    </main>
  </div>;
}

function Nav({ href, path, active, icon, children }: { href: string; path: string; active?: boolean; icon: string; children: ReactNode }) {
  return <a href={href} className={active || path === href ? 'active' : undefined}><span aria-hidden="true">{icon}</span><strong>{children}</strong></a>;
}

function SyncChip({ me }: { me: Me }) {
  return <span className={`sync-chip ${me.dryRun ? 'quiet' : ''}`}>{me.dryRun ? 'No live changes' : 'Synced ✓'}</span>;
}

function PageHeader({ title, subtitle, side }: { title: string; subtitle: string; side?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{side}</header>;
}

function Dashboard({ me }: { me: Me }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftHidden, setDraftHidden] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api<DashboardData>('/api/dashboard').then((result) => { setData(result); setDraftHidden(result.hiddenCategoryIds); }); }, []);
  useEffect(() => {
    if (!pickerOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPickerOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [pickerOpen]);
  if (!data) return <Loading />;
  const hot = [...data.categories].filter((category) => category.pace !== null).sort((a, b) => (b.pace ?? 0) - (a.pace ?? 0))[0];
  const attention = hot && (hot.pace ?? 0) >= .9 ? hot.name : 'Nothing urgent';
  const memberStatus = me.role === 'member' ? memberPaceSummary(data) : null;
  const openPicker = () => { setDraftHidden(data.hiddenCategoryIds); setPickerOpen(true); };
  const saveCategories = async () => {
    setSaving(true);
    const result = await api<{ hiddenCategoryIds: string[] }>('/api/dashboard/categories', { method: 'PUT', body: JSON.stringify({ hiddenCategoryIds: draftHidden }) });
    const hidden = new Set(result.hiddenCategoryIds);
    setData((current) => current && ({ ...current, hiddenCategoryIds: result.hiddenCategoryIds, categories: current.availableCategories.filter((category) => !hidden.has(category.id)) }));
    setSaving(false); setPickerOpen(false);
  };
  return <section className="screen overview-screen">
    <header className="overview-header"><div><strong>{me.name}</strong><span>Household budget</span></div><div className="overview-actions"><button className="category-visibility-button" onClick={openPicker}><span aria-hidden="true">≡</span> Show / hide</button><SyncChip me={me} /></div></header>
    {me.role === 'admin' && data.readyToAssignMilli !== undefined && <section className="available-hero" aria-label={`${moneyExact(data.readyToAssignMilli)} ready to assign`}>
      <span>Ready to assign</span>
      <strong>{moneyExact(data.readyToAssignMilli)}</strong>
      <div className="hero-chips"><span>{data.daysLeft} days left</span><span>{attention}</span></div>
    </section>}
    {memberStatus && <section className={`member-status-hero ${memberStatus.tone}`} aria-label={`Monthly pace: ${memberStatus.label}`}>
      <span>Your month</span>
      <strong>{memberStatus.label}</strong>
      <p>{memberStatus.detail}</p>
      <div className="member-status-chips"><span>{data.daysLeft} days left</span><span>{memberStatus.attention ? `${memberStatus.attention} need attention` : 'Nothing needs attention'}</span><span>{moneyExact(memberStatus.assignedMilli)} assigned</span></div>
    </section>}
    <div className="section-heading overview-section-heading"><h2>Category pace</h2><div><span>{data.categories.length} of {data.availableCategories.length} visible</span><button className="category-visibility-button mobile-category-control" onClick={openPicker}><span aria-hidden="true">≡</span> Show / hide</button></div></div>
    {data.categories.length ? <div className="pace-list">{data.categories.map((category) => <CategoryRow key={category.id} category={category} />)}</div> : <div className="pace-list overview-empty"><EmptyState title="No categories showing" body="Use Show / hide to choose what belongs on your overview." /></div>}
    {pickerOpen && <div className="category-picker-backdrop" onClick={() => setPickerOpen(false)}><section className="category-picker" role="dialog" aria-modal="true" aria-labelledby="category-picker-title" onClick={(event) => event.stopPropagation()}>
      <header><div><h2 id="category-picker-title">Overview categories</h2><p>Choose what appears here. This does not change YNAB.</p></div><button className="picker-close" aria-label="Close category picker" onClick={() => setPickerOpen(false)}>×</button></header>
      <div className="picker-tools"><span>{data.availableCategories.length - draftHidden.length} showing</span><button onClick={() => setDraftHidden([])} disabled={!draftHidden.length}>Show all</button></div>
      <div className="category-picker-list">{data.availableCategories.map((category) => { const visible = !draftHidden.includes(category.id); return <div className="category-picker-row" key={category.id}><div><strong>{category.name}</strong><span>{category.groupName}</span></div><button className="toggle" role="switch" aria-checked={visible} aria-label={`Show ${category.name} on overview`} onClick={() => setDraftHidden((current) => visible ? [...current, category.id] : current.filter((id) => id !== category.id))}><i /></button></div>; })}</div>
      <footer><button className="secondary-action" onClick={() => setPickerOpen(false)} disabled={saving}>Cancel</button><button className="primary-action compact" onClick={saveCategories} disabled={saving}>{saving ? 'Saving…' : 'Save overview'}</button></footer>
    </section></div>}
  </section>;
}

function CategoryRow({ category }: { category: Category }) {
  const percent = Math.min(100, Math.max(0, Math.round((category.pace ?? 0) * 100)));
  return <a className="pace-row" href={`/category/${encodeURIComponent(category.id)}`} aria-label={`View ${category.name} transactions`}>
    <div className="pace-row-top"><strong>{category.name}</strong><span><b>{money(category.balanceMilli)}</b> left</span></div>
    <div className="pace-row-bottom"><span className="progress-track"><i style={{ width: `${percent}%`, background: accentFor(category.id) }} /></span><span>{percent}%</span></div>
  </a>;
}

function CategoryDetail({ id }: { id: string }) {
  const [data, setData] = useState<CategoryDetailData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { api<CategoryDetailData>(`/api/categories/${encodeURIComponent(id)}/transactions`).then(setData).catch(() => setFailed(true)); }, [id]);
  if (failed) return <section className="screen"><PageHeader title="Category unavailable" subtitle="It may be outside your visible budget scope." /><a className="text-link" href="/">← Back to overview</a></section>;
  if (!data) return <Loading />;
  const spent = Math.abs(data.summary.activityMilli);
  return <section className="screen category-screen">
    <a className="back-link" href="/">← Category pace</a>
    <PageHeader title={data.category.name} subtitle={`${data.category.groupName} · ${new Date(`${data.month}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`} />
    <div className="category-summary">
      <div className="category-balance"><span>Available</span><strong>{money(data.summary.balanceMilli)}</strong></div>
      <dl><div><dt>Assigned</dt><dd>{money(data.summary.budgetedMilli)}</dd></div><div><dt>Spent</dt><dd>{money(spent)}</dd></div><div><dt>Activity</dt><dd>{moneyExact(data.summary.activityMilli)}</dd></div></dl>
    </div>
    <div className="section-heading"><h2>Transactions</h2><span>{data.transactions.length} recent</span></div>
    <div className="transaction-list">{data.transactions.length ? data.transactions.map((transaction) => <div className="transaction-row" key={transaction.id}>
      <time dateTime={transaction.date}>{new Date(`${transaction.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
      <div><strong>{transaction.payeeName ?? transaction.importPayeeNameOriginal ?? 'Unknown merchant'}</strong><span>{transaction.accountName}{transaction.memo ? ` · ${transaction.memo}` : ''}</span></div>
      <b className={transaction.amountMilli > 0 ? 'positive' : ''}>{moneyExact(transaction.amountMilli)}</b>
    </div>) : <EmptyState title="No transactions yet" body="Nothing assigned to this category appears in the synced history." />}</div>
  </section>;
}

function Queue() {
  const [items, setItems] = useState<any[] | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; groupName: string }>>([]);
  const [showMore, setShowMore] = useState(false);
  const [moving, setMoving] = useState<'answer' | 'skip' | null>(null);
  const pointerStart = useRef<number | null>(null);
  const load = async () => {
    let [queue, cats] = await Promise.all([api<any[]>('/api/queue'), api<any[]>('/api/categories')]);
    if (queue.some((candidate) => candidate.enrichment?.lookupVersion !== 3 || !candidate.suggestions.some((suggestion: any) => suggestion.categoryId))) {
      try {
        await api('/api/queue/enrich', { method: 'POST' });
        queue = await api<any[]>('/api/queue');
      } catch {
        // Keep the manual category picker available if the lookup service is temporarily unavailable.
      }
    }
    setItems(queue); setCategories(cats); setShowMore(false);
  };
  useEffect(() => { load(); }, []);
  if (!items) return <Loading />;
  const item = items[0];
  if (!item) return <section className="screen"><PageHeader title="Mystery queue" subtitle="Tap a category. That's the whole job." /><EmptyState title="All caught up" body="Nothing is waiting on your memory right now." /></section>;
  const answer = async (categoryId: string | null) => { setMoving('answer'); await api(`/api/queue/${item.transactionId}`, { method: 'PATCH', body: JSON.stringify({ categoryId }) }); await load(); setMoving(null); };
  const skip = async () => { if (moving) return; setMoving('skip'); await api(`/api/queue/${item.transactionId}/skip`, { method: 'POST' }); setItems((current) => current && current.length > 1 ? [...current.slice(1), current[0]] : current); setShowMore(false); setMoving(null); };
  const onPointerDown = (event: PointerEvent<HTMLElement>) => { pointerStart.current = event.clientX; };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => { if (pointerStart.current !== null && Math.abs(event.clientX - pointerStart.current) > 56) void skip(); pointerStart.current = null; };
  const suggestions = item.suggestions.filter((suggestion: any) => suggestion.categoryId).slice(0, 2);
  const suggestedIds = new Set(suggestions.map((suggestion: any) => suggestion.categoryId));
  const transactionDate = new Date(`${item.transaction.date}T12:00:00`);
  const dayDifference = Math.round((new Date(new Date().toDateString()).getTime() - transactionDate.getTime()) / 86400000);
  const dateLabel = dayDifference === 1 ? 'Yesterday' : transactionDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return <section className="screen queue-screen">
    <PageHeader title="Mystery queue" subtitle="Tap a category. That's the whole job." side={<span className="page-counter">1 of {items.length}</span>} />
    <article className={`charge-card ${moving ? `is-${moving}` : ''}`} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <p className="charge-meta">{dateLabel} · {item.transaction.accountName ?? 'Card purchase'}</p>
      <h2>{item.transaction.importPayeeNameOriginal ?? item.transaction.payeeName ?? 'Unknown merchant'}</h2>
      <strong className="charge-amount">{moneyExact(Math.abs(item.transaction.amountMilli))}</strong>
      <div className="guess-chips">{suggestions.map((suggestion: any, index: number) => <button key={suggestion.categoryId} className={index === 0 ? 'best-guess' : ''} onClick={() => answer(suggestion.categoryId)} disabled={Boolean(moving)}>{suggestion.label}</button>)}<button className="something-else" onClick={() => setShowMore((current) => !current)} aria-expanded={showMore}>Something else…</button></div>
      {item.enrichment?.lookupComplete && suggestions.length > 0 && <p className="lookup-note"><span>{item.enrichment.source === 'household-preference' ? 'Household match' : 'AI lookup'}</span>{item.enrichment.blurb}</p>}
      {showMore && <div className="category-choices">{categories.filter((category) => !suggestedIds.has(category.id)).map((category) => <button key={category.id} onClick={() => answer(category.id)}><strong>{category.name}</strong><span>{category.groupName}</span></button>)}<button onClick={() => answer(null)}><strong>I don't know</strong><span>Send to Unknown</span></button></div>}
      <button className="skip-button" onClick={skip} disabled={Boolean(moving)}>Best guess first · swipe or tap to skip</button>
    </article>
    <div className="progress-dots" aria-hidden="true">{items.slice(0, 5).map((queueItem, index) => <i className={index === 0 ? 'active' : ''} key={queueItem.transactionId} />)}</div>
  </section>;
}

function Chat() {
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const turnRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const turnToScrollTo = useRef<number | null>(null);
  const starters = [
    { title: 'Last month at a glance', question: 'Where did my money go last month?' },
    { title: 'Food, past 30 days', question: 'Show my food spending over the past 30 days' },
    { title: 'What needs attention?', question: 'Which categories are running hot this month?' },
    { title: 'Three-month trend', question: 'Show my spending trend over the previous three months' },
  ];
  const runQuestion = async (value: string) => {
    const question = value.trim();
    if (!question || busy) return;
    const id = Date.now();
    turnToScrollTo.current = id;
    setTurns((current) => [...current, { id, question, answer: { answer_md: '', chart: null, followups: [] }, pending: true }]);
    setMessage(''); setBusy(true); setError('');
    try {
      const complete = await streamChat<ChatAnswer>(question, (chunk) => setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, answer: { ...turn.answer, answer_md: turn.answer.answer_md + chunk } } : turn)));
      turnToScrollTo.current = id;
      setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, answer: complete, pending: false } : turn));
    } catch (reason) {
      if (turnToScrollTo.current === id) turnToScrollTo.current = null;
      setTurns((current) => current.filter((turn) => turn.id !== id));
      setError(reason instanceof Error ? reason.message : 'The budget could not answer right now.');
    } finally { setBusy(false); }
  };
  useEffect(() => {
    const id = turnToScrollTo.current;
    if (id === null) return;
    const turn = turnRefs.current.get(id);
    if (!turn) return;
    turnToScrollTo.current = null;
    turn.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  }, [turns]);
  const ask = (event: FormEvent) => { event.preventDefault(); void runQuestion(message); };
  return <section className="screen chat-screen">
    <PageHeader title="Ask the budget" subtitle="Numbers first. No pep talk." />
    <div className="chat-transcript" aria-live="polite">{turns.length ? turns.map((turn) => <div className="chat-turn" key={turn.id} ref={(node) => {
      if (node) turnRefs.current.set(turn.id, node);
      else turnRefs.current.delete(turn.id);
    }}>
      <div className="question-bubble">{turn.question}</div>
      <div className="answer-card"><p className={turn.pending ? 'streaming-answer' : ''}>{turn.answer.answer_md || 'Checking the numbers…'}</p><AnswerVisual chart={turn.answer.chart} onQuery={(query) => void runQuestion(query)} disabled={busy} /><small>Scoped to what you're allowed to see.</small>{!turn.pending && Boolean(turn.answer.followups?.length) && <div className="followup-chips">{turn.answer.followups.map((followup) => <button key={followup} onClick={() => void runQuestion(followup)} disabled={busy}>{followup}</button>)}</div>}</div>
    </div>) : <div className="chat-welcome"><strong>What do you want to know?</strong><p>Ask anything, or start with one of these.</p><div className="chat-starters">{starters.map((starter) => <button type="button" key={starter.question} onClick={() => void runQuestion(starter.question)} disabled={busy}><strong>{starter.title}</strong><span>{starter.question}</span></button>)}</div></div>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <form className="chat-input" onSubmit={ask}><input value={message} onChange={(event) => setMessage(event.target.value)} aria-label="Budget question" placeholder="Ask anything…" disabled={busy} /><button disabled={busy || !message.trim()}>{busy ? 'Thinking' : 'Ask'}</button></form>
  </section>;
}

function AnswerVisual({ chart, onQuery, disabled = false }: { chart: any; onQuery?: (query: string) => void; disabled?: boolean }) {
  if (!chart) return null;
  if (chart.type === 'category_donut') {
    const slices = chart.slices.filter((slice: any) => slice.value > 0);
    const total = slices.reduce((sum: number, slice: any) => sum + slice.value, 0);
    let offset = 0;
    const segments = slices.map((slice: any, index: number) => { const start = offset; const percent = total ? slice.value / total * 100 : 0; offset += percent; return { ...slice, start, percent, color: accents[index % accents.length] }; });
    const runSlice = (slice: any) => { if (!disabled && slice.query && onQuery) onQuery(slice.query); };
    return <section className="answer-visual donut-visual" aria-label="Spending by category">
      <div className="donut-plot"><svg viewBox="0 0 100 100" role="group" aria-label={`${chartMoney(total)} total across ${slices.length} categories`}>{segments.map((slice: any) => <circle className={slice.query ? 'donut-segment interactive' : 'donut-segment'} key={slice.label} cx="50" cy="50" r="38" pathLength="100" fill="none" stroke={slice.color} strokeWidth="22" strokeDasharray={`${slice.percent} ${100 - slice.percent}`} strokeDashoffset={-slice.start} transform="rotate(-90 50 50)" role={slice.query ? 'button' : undefined} tabIndex={slice.query ? 0 : undefined} aria-label={`${slice.label}, ${chartMoney(slice.value)}${slice.query ? '. Show transactions for this period' : ''}`} aria-disabled={slice.query ? disabled : undefined} onClick={() => runSlice(slice)} onKeyDown={(event) => { if (slice.query && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); runSlice(slice); } }} />)}</svg><div><span>Total spent</span><strong>{chartMoney(total)}</strong></div></div>
      <div className="chart-legend"><h3>{chart.title ?? 'Where it went'}</h3>{segments.map((slice: any) => slice.query ? <button type="button" className="donut-legend-action" key={slice.label} onClick={() => runSlice(slice)} disabled={disabled}><i style={{ background: slice.color }} /><span>{slice.label}</span><strong>{chartMoney(slice.value)}</strong></button> : <div key={slice.label}><i style={{ background: slice.color }} /><span>{slice.label}</span><strong>{chartMoney(slice.value)}</strong></div>)}</div>
    </section>;
  }
  if (chart.type === 'stat_card') return <section className={`answer-visual stat-visual ${chart.verdict}`} aria-label="Category status"><span>{chart.title ?? 'Available now'}</span><strong>{chart.value}</strong>{chart.delta && <em>{chart.delta}</em>}</section>;
  if (chart.type === 'txn_list') return <section className="answer-visual transaction-visual"><h3>{chart.title ?? 'Transactions'}</h3>{chart.rows.map((row: any, index: number) => <div key={`${row.date}-${row.payee}-${index}`}><time>{new Date(`${row.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time><span><strong>{row.payee}</strong>{row.memo && <small>{row.memo}</small>}</span><b>{chartMoney(row.amount, 2)}</b></div>)}</section>;
  if (chart.type === 'trend_line') {
    const values = chart.series.map((point: any) => Math.abs(point.value));
    const max = Math.max(...values, 1);
    const points = values.map((value: number, index: number) => `${chart.series.length === 1 ? 160 : 12 + index * 296 / (chart.series.length - 1)},${96 - value / max * 76}`).join(' ');
    return <section className="answer-visual trend-visual"><div className="visual-heading"><h3>{chart.title ?? 'Spending over time'}</h3><strong>{chartMoney(values.reduce((sum: number, value: number) => sum + value, 0))} total</strong></div><svg viewBox="0 0 320 108" role="img" aria-label="Spending trend"><line x1="12" y1="96" x2="308" y2="96" /><polyline points={points} />{points.split(' ').map((point: string, index: number) => { const [cx, cy] = point.split(','); return <circle key={chart.series[index].label} cx={cx} cy={cy} r="3.5" />; })}</svg><div className="trend-labels"><span>{chart.series[0]?.label}</span><span>{chart.series.at(-1)?.label}</span></div></section>;
  }
  if (chart.type === 'monthly_category_bars') {
    const months = chart.months ?? [];
    const max = Math.max(...months.map((month: any) => month.total), 1);
    const categoryTotals = new Map<string, number>();
    months.forEach((month: any) => month.segments.forEach((segment: any) => categoryTotals.set(segment.label, (categoryTotals.get(segment.label) ?? 0) + segment.value)));
    const categories = [...categoryTotals].sort((left, right) => right[1] - left[1]);
    const total = months.reduce((sum: number, month: any) => sum + month.total, 0);
    return <section className="answer-visual monthly-bars-visual"><div className="visual-heading"><h3>{chart.title ?? 'Spending by month'}</h3><strong>{chartMoney(total)} total</strong></div><div className="monthly-bars-plot" role="img" aria-label={`${chartMoney(total)} across ${months.length} months`}>{months.map((month: any) => <div className="monthly-bar-column" key={month.label} aria-label={`${month.label}: ${chartMoney(month.total)}`}><strong>{chartMoney(month.total)}</strong><div className="monthly-bar-track"><div className="monthly-bar-stack" style={{ height: `${month.total ? Math.max(8, month.total / max * 100) : 0}%` }}>{month.segments.map((segment: any) => <i key={segment.label} title={`${segment.label}: ${chartMoney(segment.value)}`} style={{ height: `${month.total ? segment.value / month.total * 100 : 0}%`, background: accentFor(segment.label) }} />)}</div></div><span>{new Date(`${month.label}T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}</span></div>)}</div><div className="monthly-category-legend">{categories.map(([label, value]) => <div key={label}><i style={{ background: accentFor(label) }} /><span>{label}</span><strong>{chartMoney(value)}</strong></div>)}</div></section>;
  }
  if (chart.type === 'bar_vs_budget') {
    const rows = chart.series.map((series: any) => ({ label: series.label, value: series.spent }));
    const max = Math.max(...rows.map((row: any) => Math.abs(row.value)), chart.budget ?? 0, 1);
    return <section className="answer-visual bar-visual"><div className="visual-heading"><h3>{chart.title ?? 'Spending breakdown'}</h3>{chart.budget > 0 && <strong>{chartMoney(chart.budget)} assigned</strong>}</div><div className="answer-rows">{rows.slice(0, 7).map((row: any) => <div key={row.label}><strong>{row.label}</strong><span className="progress-track"><i style={{ width: `${Math.max(4, Math.abs(row.value) / max * 100)}%`, background: accentFor(row.label) }} /></span><b>{chartMoney(row.value)}</b></div>)}</div></section>;
  }
  return null;
}

function Settings() {
  const [settings, setSettings] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [savedNames, setSavedNames] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => { Promise.all([api<any>('/api/settings'), api<any[]>('/api/categories')]).then(([value, cats]) => { const essentials = value.essentials_category_names ?? []; setSettings(value); setCategories(cats); setNames(essentials); setSavedNames(essentials); }); }, []);
  if (!settings) return <Loading />;
  const dirty = JSON.stringify([...names].sort()) !== JSON.stringify([...savedNames].sort());
  const toggle = (name: string) => { setSaved(false); setNames((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]); };
  const save = async () => { const result = await api<{ categoryNames: string[] }>('/api/settings/essentials', { method: 'PUT', body: JSON.stringify({ categoryNames: names }) }); setNames(result.categoryNames); setSavedNames(result.categoryNames); setSaved(true); };
  return <section className="screen settings-screen">
    <PageHeader title="What counts as essential?" subtitle="Only checked categories may auto-fund — never beyond YNAB's underfunded amount." />
    <div className="toggle-list">{categories.map((category) => { const checked = names.includes(category.name); return <div className="toggle-row" key={category.id}><div><strong>{category.name}</strong><span>{category.groupName}</span></div><button className="toggle" role="switch" aria-checked={checked} aria-label={`${category.name} essential`} onClick={() => toggle(category.name)}><i /></button></div>; })}</div>
    <div className="boundary-note"><strong>Tight boundary.</strong> Unchecking a category returns it to propose-and-approve immediately.</div>
    <button className="primary-action full-width" onClick={save} disabled={!dirty}>{saved ? 'Essentials saved' : dirty ? 'Save essentials' : 'Everything saved'}</button>
  </section>;
}

function Admin() {
  const [data, setData] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [approvalDraft, setApprovalDraft] = useState<any>(null);
  const [savingApproval, setSavingApproval] = useState(false);
  const [approvalSaved, setApprovalSaved] = useState(false);
  const load = async () => { const result = await api<any>('/api/admin'); setData(result); setApprovalDraft(result.approval.settings); return result; };
  useEffect(() => { load(); }, []);
  const sync = async () => { setRunning(true); await api('/api/admin/sync', { method: 'POST' }); await load(); setRunning(false); };
  const toggleRule = async (rule: any) => { await api(`/api/rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !rule.enabled }) }); await load(); };
  const saveApproval = async () => { setSavingApproval(true); setApprovalSaved(false); const saved = await api('/api/settings/approval', { method: 'PUT', body: JSON.stringify(approvalDraft) }); setApprovalDraft(saved); await load(); setApprovalSaved(true); setSavingApproval(false); };
  if (!data || !approvalDraft) return <Loading />;
  const transactionSync = data.sync.find((item: any) => item.resource === 'transactions');
  const healthy = transactionSync?.status !== 'failed';
  const approvalChanged = JSON.stringify(approvalDraft) !== JSON.stringify(data.approval.settings);
  const approvalState = !approvalDraft.enabled ? 'Paused' : approvalDraft.mode === 'review' ? 'Review only' : data.approval.dryRun ? 'Simulating' : 'Automatic';
  const nextPass = new Date(`${data.funding.nextMonthlyPass}T08:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return <section className="screen admin-screen">
    <PageHeader title="System" subtitle="Nothing downstream runs on a partial picture." side={<button className="primary-action compact" onClick={sync} disabled={running}>{running ? 'Reconciling…' : 'Run sync'}</button>} />
    <section className={`system-health ${healthy ? '' : 'failed'}`}><div><span>{healthy ? 'System ready' : 'Jobs paused'}</span><strong>{transactionSync?.status ?? 'Not synced'}</strong></div><p>{transactionSync?.lastReconciledAt ? `Last reconciled ${new Date(transactionSync.lastReconciledAt).toLocaleString()}` : 'Run the first sync to reconcile local and YNAB counts.'}</p></section>
    <div className="system-strip"><div><span>Open proposals</span><strong>{data.proposals.filter((proposal: any) => proposal.status === 'open').length}</strong></div><div><span>Logged writes</span><strong>{data.writes.length}</strong></div><div><span>Routing rules</span><strong>{data.rules.length}</strong></div></div>
    <section className="system-panel approval-panel">
      <div className="section-heading"><div><h2>Approval assistant</h2><p>Approve only familiar, predictable transactions.</p></div><span className={`state-badge ${approvalDraft.enabled ? '' : 'paused'}`}>{approvalState}</span></div>
      <div className="approval-master"><div><strong>Automatic approval</strong><span>Master control for transactions that pass every safeguard.</span></div><button className="toggle" role="switch" aria-checked={approvalDraft.enabled} aria-label="Automatic approval enabled" onClick={() => { setApprovalSaved(false); setApprovalDraft((current: any) => ({ ...current, enabled: !current.enabled })); }}><i /></button></div>
      <div className="mode-picker" aria-label="Approval behavior"><button className={approvalDraft.mode === 'review' ? 'selected' : ''} onClick={() => { setApprovalSaved(false); setApprovalDraft((current: any) => ({ ...current, mode: 'review' })); }}><strong>Review only</strong><span>Show matches without approving</span></button><button className={approvalDraft.mode === 'automatic' ? 'selected' : ''} onClick={() => { setApprovalSaved(false); setApprovalDraft((current: any) => ({ ...current, mode: 'automatic' })); }}><strong>Automatic</strong><span>Approve matches after sync</span></button></div>
      <div className="guardrail-grid">
        <label><span>Prior purchases</span><input type="number" min="3" max="50" value={approvalDraft.minHistory} onChange={(event) => { setApprovalSaved(false); setApprovalDraft((current: any) => ({ ...current, minHistory: Number(event.target.value) })); }} /><small>Minimum merchant history</small></label>
        <label><span>Category match</span><div className="number-suffix"><input type="number" min="50" max="100" value={approvalDraft.consistencyPercent} onChange={(event) => { setApprovalSaved(false); setApprovalDraft((current: any) => ({ ...current, consistencyPercent: Number(event.target.value) })); }} /><b>%</b></div><small>Required consistency</small></label>
        <label><span>Amount tolerance</span><div className="number-suffix"><input type="number" min="0.5" max="5" step="0.5" value={approvalDraft.standardDeviations} onChange={(event) => { setApprovalSaved(false); setApprovalDraft((current: any) => ({ ...current, standardDeviations: Number(event.target.value) })); }} /><b>σ</b></div><small>Above normal average</small></label>
        <label><span>Per sync limit</span><input type="number" min="1" max="500" value={approvalDraft.maxPerRun} onChange={(event) => { setApprovalSaved(false); setApprovalDraft((current: any) => ({ ...current, maxPerRun: Number(event.target.value) })); }} /><small>Emergency backstop</small></label>
      </div>
      <div className="control-footer"><p>{data.approval.dryRun ? 'No live YNAB approvals while the server is in dry-run mode.' : 'Automatic mode writes approvals directly to YNAB.'}</p><button className="primary-action compact" onClick={saveApproval} disabled={!approvalChanged || savingApproval}>{savingApproval ? 'Saving…' : approvalSaved ? 'Saved' : 'Save approval settings'}</button></div>
      <div className="approval-audit">
        <section><div className="section-heading"><h3>Waiting for review</h3><span>{data.approval.pending.length}</span></div><div className="compact-list">{data.approval.pending.length ? data.approval.pending.slice(0, 6).map((item: any) => <div className="audit-row" key={item.transaction.id}><div><strong>{item.transaction.payeeName}</strong><span>{item.transaction.categoryName} · {item.evaluation.reason}</span></div><b>{moneyExact(item.transaction.amountMilli)}</b></div>) : <p className="quiet-empty">No categorized transactions are waiting.</p>}</div></section>
        <section><div className="section-heading"><h3>Recent decisions</h3><span>{data.approval.recent.length}</span></div><div className="compact-list">{data.approval.recent.length ? data.approval.recent.slice(0, 6).map((item: any) => <div className="audit-row" key={item.id}><div><strong>{item.transaction?.payeeName ?? 'Transaction'}</strong><span>{item.transaction?.categoryName ?? 'Category'} · {item.dryRun ? 'simulated' : 'approved'} {new Date(item.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div><b>{item.transaction ? moneyExact(item.transaction.amountMilli) : '—'}</b></div>) : <p className="quiet-empty">The first qualifying decision will appear here.</p>}</div></section>
      </div>
    </section>
    <section className="system-panel funding-panel">
      <div className="section-heading"><div><h2>Funding pass</h2><p>Essentials first, then proposals for everything else.</p></div><span className="state-badge">Monthly</span></div>
      <div className="funding-metrics"><div><span>Ready to assign</span><strong>{money(data.funding.readyToAssignMilli)}</strong></div><div><span>Underfunded now</span><strong>{money(data.funding.underfundedMilli)}</strong><small>{data.funding.underfundedCount} active categories</small></div><div><span>Next pass</span><strong>{nextPass}</strong><small>8:00 AM Eastern</small></div></div>
      <div className="funding-detail"><div><strong>{data.funding.selectedEssentials.length} essentials selected</strong><span>Only active, unhidden YNAB categories are eligible. Hiding one removes it after the next sync.</span></div><a className="text-link" href="/settings">Review essentials →</a></div>
      <div className="section-heading proposal-heading"><h3>Funding proposals</h3><span>{data.funding.recentProposals.length} recent</span></div>
      <div className="compact-list">{data.funding.recentProposals.length ? data.funding.recentProposals.map((proposal: any) => <div className="audit-row" key={proposal.id}><div><strong>Proposal {proposal.id}</strong><span>{new Date(proposal.createdAt).toLocaleString()}</span></div><em className={`proposal-status ${proposal.status}`}>{proposal.status}</em></div>) : <p className="quiet-empty">No funding passes have produced a proposal yet.</p>}</div>
    </section>
    <div className="admin-columns"><section><div className="section-heading"><h2>Recent writes</h2><span>Newest 30</span></div><div className="system-list">{data.writes.length ? data.writes.map((write: any) => <div className="system-row" key={write.id}><div><strong>{write.actor}</strong><span>{write.endpoint}</span></div><em>{write.dryRun ? 'dry run' : write.responseStatus}</em></div>) : <EmptyState title="No writes yet" body="Changes and dry-run previews will appear here." />}</div></section><section><div className="section-heading"><h2>Routing rules</h2><span>{data.rules.filter((rule: any) => rule.enabled).length} on</span></div><div className="system-list">{data.rules.map((rule: any) => <div className="system-row" key={rule.id}><div><strong>{rule.pattern}</strong><span>{rule.action.categoryName ?? rule.action.route} · {rule.hitCount} hits</span></div><button className="toggle small" role="switch" aria-checked={rule.enabled} aria-label={`${rule.pattern} enabled`} onClick={() => toggleRule(rule)}><i /></button></div>)}</div></section></div>
  </section>;
}

function SignIn() {
  const [userId, setUserId] = useState<'admin' | 'member'>('admin');
  const [pin, setPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [error, setError] = useState('');
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({ appName: brand.name, adminName: 'Admin', memberName: 'Member' });
  useEffect(() => { api<PublicConfig>('/public-config').then(setPublicConfig).catch(() => undefined); }, []);
  const displayName = userId === 'admin' ? publicConfig.adminName : publicConfig.memberName;
  const chooseUser = (value: 'admin' | 'member') => { setUserId(value); setPin(''); setError(''); setSmsSent(false); setSmsConsent(false); };
  const requestSms = async () => {
    if (smsBusy || !smsConsent) return;
    setSmsBusy(true); setSmsSent(false); setError('');
    try {
      await api('/auth/sms', { method: 'POST', body: JSON.stringify({ userId }) });
      setSmsSent(true);
      setSmsConsent(false);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : '';
      setError(code === 'too_many_links' ? 'Too many links were requested. Try again in an hour.' : 'The text could not be delivered. You can still use your PIN.');
    } finally { setSmsBusy(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pinBusy || pin.length !== 6) return;
    setPinBusy(true); setError('');
    try {
      await api('/auth/pin', { method: 'POST', body: JSON.stringify({ userId, pin }) });
      window.location.assign('/');
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : '';
      setError(code === 'too_many_attempts' ? 'Too many attempts. Try again in 15 minutes.' : 'That PIN does not match this household member.');
      setPin(''); setPinBusy(false);
    }
  };
  return <main className="signin"><section className="signin-card"><BrandLockup className="signin-brand" /><h1>Welcome home.</h1><p>Choose who is checking in. We can text a private, one-time sign-in link to the phone already on file.</p>
    <div className="identity-switch" role="group" aria-label="Household member">
      <button type="button" className={userId === 'admin' ? 'selected' : ''} aria-pressed={userId === 'admin'} onClick={() => chooseUser('admin')}><span>{publicConfig.adminName.slice(0, 1).toUpperCase()}</span><strong>{publicConfig.adminName}</strong><small>Admin</small></button>
      <button type="button" className={userId === 'member' ? 'selected' : ''} aria-pressed={userId === 'member'} onClick={() => chooseUser('member')}><span>{publicConfig.memberName.slice(0, 1).toUpperCase()}</span><strong>{publicConfig.memberName}</strong><small>Member</small></button>
    </div>
    <div className="sms-signin"><label className="sms-consent"><input type="checkbox" checked={smsConsent} onChange={(event) => setSmsConsent(event.target.checked)} /><span>I agree to receive one {publicConfig.appName} authentication text at the registered number for this profile. Message frequency: one message per request, limited to three requests per hour. Message and data rates may apply. Reply STOP to opt out or HELP for help. <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></span></label><button type="button" className="primary-action" onClick={requestSms} disabled={smsBusy || !smsConsent}>{smsBusy ? "Sending securely…" : smsSent ? "Send another link" : ["Text ", displayName, " a sign-in link"].join("")}</button>{smsSent && <p className="sms-success" role="status"><strong>Check your messages.</strong> The link expires in 15 minutes and works once.</p>}</div>
    <div className="auth-divider"><span>or use the household PIN</span></div>
    <form onSubmit={submit}><label className="pin-field"><span>Six-digit PIN</span><input type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{6}" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" aria-describedby={error ? 'signin-error' : undefined} required /></label>{error && <p className="signin-error" id="signin-error" role="alert">{error}</p>}<button className="pin-action" disabled={pinBusy || pin.length !== 6}>{pinBusy ? 'Signing in…' : `Continue as ${displayName}`}</button></form>
    <small className="signin-note">Only the two registered household numbers can receive a link. PIN access stays available as a fallback.</small>
  </section></main>;
}

function Loading({ label = 'Bringing the numbers into focus' }: { label?: string }) {
  return <section className="screen loading" aria-label={label}><div className="skeleton-title" /><div className="skeleton-hero" /><div className="skeleton-list">{[0, 1, 2, 3].map((item) => <span key={item} />)}</div></section>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><span aria-hidden="true">✓</span><strong>{title}</strong><p>{body}</p></div>;
}

export default App;
