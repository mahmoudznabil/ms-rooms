/**
 * Legal documents — bilingual (English / Arabic), versioned.
 *
 * WHY A MODULE AND NOT A CMS. These texts are legal commitments, so two
 * properties matter more than editability:
 *
 *   1. They are part of the shipped bundle. A consent record that cites a
 *      document version nobody can reproduce later is worthless as evidence.
 *   2. They are versioned and immutable once accepted. Accepting "the current
 *      terms" is only meaningful if "current" is a fixed string that can be
 *      stored alongside the consent row and looked up again years later.
 *
 * Both are easier to guarantee from source than from a mutable store.
 *
 * ---------------------------------------------------------------------------
 * PLACEHOLDERS — READ BEFORE PUBLISHING
 * ---------------------------------------------------------------------------
 * Every double-braced marker below must be replaced with the operator's real
 * details before this is offered to anyone. They are deliberately left
 * unsubstituted rather than filled with invented values: a plausible-looking
 * but false registered address, licence number, or governing-law clause is
 * worse than an obvious gap, because it is harder to notice and it is still a
 * false statement to a customer.
 *
 * Run `npm run check:legal` to list what is still unfilled.
 *
 * These documents are a solid starting point drafted to match how this product
 * actually works. They have not been reviewed by a qualified lawyer in the
 * operator's jurisdiction, and they are not legal advice.
 */

/** Locale codes this product ships legal text in. */
export const LEGAL_LANGS = ["en", "ar"] as const;
export type LegalLang = (typeof LEGAL_LANGS)[number];

export const DEFAULT_LEGAL_LANG: LegalLang = "en";

/** Every document a user must accept before the product is unlocked. */
export const REQUIRED_LEGAL_DOCS = ["terms", "privacy", "guidelines"] as const;
export type LegalDocKey = (typeof REQUIRED_LEGAL_DOCS)[number];

/**
 * The version string recorded with every acceptance.
 *
 * Bump this ONLY when the text of a document actually changes, and only after
 * the change is live. Users who accepted `2026-10-17` are re-gated for
 * `2026-11-01` — that is the intended effect: a material change to the terms
 * is exactly the case where fresh consent is required.
 */
export const LEGAL_VERSION = "2026-10-17";

export const MINIMUM_AGE = 18;

/**
 * Whether a RETURNING user without current consent is blocked or merely asked.
 *
 * This needs to be a decision rather than a default because the first rollout
 * and a later revision are genuinely different situations:
 *
 *   - FIRST ROLLOUT (false, as shipped). Every existing account has
 *     `legal_consent_version = NULL`, because nobody accepted text that did not
 *     exist when they signed up. Hard-blocking them would lock out customers who
 *     have paid, and would assert consent that never happened. So they get a
 *     persistent, dismissable prompt instead.
 *
 *   - A REVISION (set true, together with a LEGAL_VERSION bump). Here the text
 *     genuinely changed after they agreed, so re-acceptance is required, and
 *     holding the line is the point.
 *
 * Flipping this is how a terms revision actually takes effect. A version bump
 * on its own changes which documents count as current; this flag decides
 * whether the difference is enforced.
 */
export const LEGAL_ENFORCE_RETURNS = false;

export interface LegalSection {
  heading: { en: string; ar: string };
  body: { en: string; ar: string };
}

export interface LegalDocument {
  key: LegalDocKey;
  version: string;
  title: { en: string; ar: string };
  /** One-line summary shown in the consent list, so the user knows what they are agreeing to. */
  summary: { en: string; ar: string };
  sections: LegalSection[];
}

/* ---------------------------------------------------------------------------
 * TERMS OF SERVICE
 * ------------------------------------------------------------------------- */

const TERMS: LegalSection[] = [
  {
    heading: { en: "1. Agreement and eligibility", ar: "١. الاتفاق والأهلية" },
    body: {
      en: `By creating an account or using MS-ROOMS (the "Service"), you agree to these Terms of Service, the Privacy Policy, and the Community Guidelines, and you confirm that you have read and understood them.

You must be at least ${MINIMUM_AGE} years old to use the Service. If you are below that age, do not create an account. If you are using the Service on behalf of someone else, you confirm you are old enough to do so and that you have their authority.

If you do not agree with any part of these terms, you must not use the Service.`,
      ar: `بإنشائك حسابًا أو باستخدامك لخدمة MS-ROOMS ("الخدمة")، فإنك توافق على شروط الخدمة هذه وعلى سياسة الخصوصية وإرشادات المجتمع، وتقرّ بأنك قد قرأتَها وفهمتَها.

يجب أن يكون عمرك ${MINIMUM_AGE} عامًا على الأقل لاستخدام الخدمة. وإذا كان عمرك أقل من ذلك، فلا تنشئ حسابًا. وإذا كنت تستخدم الخدمة نيابةً عن شخص آخر، فإنك تقرّ بأنك تبلغ الحد الأدنى من العمر وأنك تملك صلاحية ذلك.

إذا لم توافق على أي جزء من هذه الشروط، فلا يجوز لك استخدام الخدمة.`,
    },
  },
  {
    heading: { en: "2. Your account", ar: "٢. حسابك" },
    body: {
      en: `You are responsible for everything that happens under your account. Keep your sign-in credentials to yourself, and tell us promptly if you think someone else has accessed your account.

You must provide accurate information and keep it up to date. You may not use the Service if you are banned, or if you have previously had an account closed for breaching these terms.

You can request deletion of your account at any time. Deletion removes your profile and personal data, subject to the retention periods described in the Privacy Policy.`,
      ar: `أنت مسؤول عن كل ما يحدث بحسابك. احتفظ ببيانات تسجيل الدخول خاصةً بك، وأخبرنا فورًا إذا كنت تعتقد أن شخصًا آخر وصل إلى حسابك.

يجب أن تقدّم معلومات صحيحة وأن تحدّثها باستمرار. لا يجوز لك استخدام الخدمة إذا كنت موقوفًا، أو إذا سبق أن أُغلق حسابك بسبب إخلالك لهذه الشروط.

يمكنك طلب حذف حسابك في أي وقت. ويؤدي الحذف إلى إزالة ملفك الشخصي وبياناتك الشخصية، مع مراعاة مدد الاحتفاظ الموضحة في سياسة الخصوصية.`,
    },
  },
  {
    heading: { en: "3. What the Service provides", ar: "٣. ما تقدمه الخدمة" },
    body: {
      en: `MS-ROOMS is a social audio platform. You can join and host rooms, take part in voice conversations, send messages, send gifts, play games in rooms, and buy coins for paid features.

The Service is provided to adults who are at least ${MINIMUM_AGE} years old. We may add, change, or remove features. Where a feature is paid for, the price and what it buys are shown before you pay.

Features may not be available in every country.`,
      ar: `MS-ROOMS منصة صوتية اجتماعية. يمكنك الانضمام إلى الغرف واستضافتها، والمشاركة في المحادثات الصوتية، وإرسال الرسائل، وإرسال الهدايا، وت ممارسة الألعاب داخل الغرف، وشراء العملات لميزات مدفوعة.

تُقدَّم الخدمة للبالغين الذين يبلغون ${MINIMUM_AGE} عامًا على الأقل. يجوز لنا إضافة ميزات أو تغييرها أو حذفها. وفي حالة أي ميزة مدفوعة، يظهر السعر وما تحصل عليه مقابله قبل الدفع.

قد لا تكون بعض الميزات متاحة في كل الدول.`,
    },
  },
  {
    heading: { en: "4. Coins, payments, and refunds", ar: "٤. العملات والمدفوعات والاسترداد" },
    body: {
      en: `Coins are the Service's virtual currency. Coins have no cash value, cannot be exchanged for cash, and cannot be transferred outside the Service.

Coins are sold in packs. We do not process card payments ourselves — an authorised payment provider does — and we never ask you for your full card number.

Your account may carry an unpaid credit allowance, described in the Privacy Policy and shown in your wallet. Until it is settled, that allowance limits how much credit your account may be issued.

Refunds are handled case by case. If you have bought coins that you have not spent and you request a refund within 14 days, we will normally refund them. Coins already spent on gifts, unlocks, or other consumed items cannot be refunded, because we cannot return them. Where a purchase was made by someone without your permission, contact us and we will investigate.

If you believe a charge was made in error, tell us promptly. We may credit your account while we investigate.`,
      ar: `العملات هي العملة الافتراضية للخدمة، وهي غير ذات قيمة نقدية، ولا يمكن استبدالها بالنقد، ولا يمكن نقلها خارج الخدمة.

تُباع العملات في باقات. نحن لا نعالج مدفوعات البطاقات بأنفسنا — بل يعالجها مزوّد دفع مرخّص — ولا نطلب منك أبدًا رقم بطاقتك كاملًا.

قد يحمل حسابك رصيد ائتمان غير مسدَّد، وستراه في محفظتك، وهو ما يحدّ من مقدار الرصيد الذي يمكن منحه لحسابك إلى أن يتم تسويته.

تُتعامل الاستردادات حالةً بحالة. إذا اشتريت عملات لم تنفقها وطلبت الاسترداد خلال ١٤ يومًا، فسنعيدها عادةً. أما العملات التي أُنفقت بالفعل على هدايا أو فتحات أو عناصر أخرى مُستهلكة فلا يمكن استردادها. وإذا تم الشراء من شخص ما دون إذنك، فتواصل معنا وسنحقق في الأمر.

إذا رأيت أن مصروفًا تم تحميله عن طريق خطأ، فأخبرنا فورًا. وقد نضيف رصيدًا إلى حسابك أثناء التحقيق.`,
    },
  },
  {
    heading: { en: "5. Your content and conduct", ar: "٥. محتواك وسلوكك" },
    body: {
      en: `You keep ownership of the content you post — your profile, your messages, your audio, and anything else you contribute. You give us a licence to host, transmit, and display that content for the purpose of running the Service, and to show it to other users as you intended.

You are responsible for what you post and say. Do not post anything unlawful, or anything that violates someone else's rights. Do not impersonate anyone. Do not record, screenshot, or redistribute other people's conversations without their consent.

We may remove content, mute you, limit your access, or close your account if you break these terms or the Community Guidelines.`,
      ar: `تحتفظ بملكية المحتوى الذي تنشره — ملفك الشخصي ورسائلك وصوتك وكل ما تساهم به. وتمنحنا ترخيصًا باستضافته ونقله وعرضه لغرض تشغيل الخدمة، وعرضه على المستخدمين الآخرين بالطريقة التي قصدتها.

أنت مسؤول عمّا تنشره وما تقوله. لا تنشر أي شيء غير قانوني أو ينتهك حقوق الآخرين. ولا تنتحل شخصية أحد. ولا تسجّل محادثات الآخرين ولا تصوّرها الشاشة ولا تعيد نشرها دون موافقتهم.

يجوز لنا إزالة المحتوى أو كتمك أو تقييد وصولك أو إغلاق حسابك إذا خالفت هذه الشروط أو إرشادات المجتمع.`,
    },
  },
  {
    heading: { en: "6. Prohibited activities", ar: "٦. الأنشطة المحظورة" },
    body: {
      en: `You must not use the Service to:
- break any law, or the rights of others;
- harass, threaten, stalk, or defame anyone;
- distribute sexual content involving minors, or sexualise minors in any way;
- promote hatred against people because of who they are;
- scam, defraud, impersonate, or run a phishing scheme;
- sell or buy accounts, coins, or access outside the Service;
- interfere with the Service, or access it through automated means in breach of these terms;
- upload malware or attack our infrastructure.`,
      ar: `لا يجوز لك استخدام الخدمة من أجل:
- مخالفة أي قانون أو حق من حقوق الآخرين؛
- مضايقة أي شخص أو تهديده أو ملاحقته أو تشهيره؛
- نشر محتوى جنسي يخص قاصرين، أو بأي طريقة من طرائق تقديم قاصرين بصورة جنسية؛
- الكراهية لأي شخص بسبب صفاته؛
- الاحتيال أو النصب أو الانتحال أو تنفيذ عمليات تصيّد؛
- بيع أو شراء الحسابات أو العملات أو الصلاحيات خارج الخدمة؛
- التعطيل الخدمة، أو الوصول إليها بوسائل آلية خلافًا لهذه الشروط؛
- رفع برمجيات ضارة أو مهاجمة بنيتنا التحتية.`,
    },
  },
  {
    heading: { en: "7. Moderation and enforcement", ar: "٧. الإشراف وإنفاذ القواعد" },
    body: {
      en: `We may act on a report, or on our own initiative, when content or conduct breaks these terms. Actions can include removing content, muting or suspending a seat, limiting features, suspending an account, or closing it permanently.

Where we suspend or close an account, you may appeal. Write to us from the email address on the account and tell us what you think we got wrong. We will look again. Banning a user for serious abuse is not reversible.`,
      ar: `قد نتخذ إجراءً بناءً على بلاغ، أو من تلقاء أنفسنا، إذا خالف المحتوى أو السلوك هذه الشروط. وقد تشمل الإجراءات إزالة المحتوى أو كتم المقعد أو تعليق الحساب أو تقييد الميزات أو إغلاقه نهائيًا.

إذا علّقنا حسابك أو أغلقناه، فيحق لك الاعتراض. راسلنا من البريد الإلكتروني المسجل في الحساب وأخبرنا بما ترى أننا أخطأنا فيه. وسننظر في الأمر مرة أخرى. أما الحظر بسبب إساءة استخدام جسيمة فلا يُقَلَب.`,
    },
  },
  {
    heading: { en: "8. Intellectual property", ar: "٨. الملكية الفكرية" },
    body: {
      en: `The Service, including its software, design, branding, and documentation, belongs to Ms-Rooms and its licensors. We grant you a limited, revocable, non-exclusive licence to use the Service as intended by these terms. You may not copy, modify, or create derivative works from the Service, except where the law says you may.

You keep ownership of your content. You grant us the licence described in section 5. You may not use the name or likeness of another person without their permission.`,
      ar: `الخدمة، بما فيها برمجياتها وتصميمها وهويتها ووثائقها، مملوكة لـ Ms-Rooms ولمرخّصيها. ونمنحك ترخيصًا محدودًا وقابلًا للسحب وغير حصري باستخدام الخدمة على النحو الذي تنص عليه هذه الشروط. لا يجوز لك نسخ الخدمة أو تعديلها أو إنشاء مشتقات منها، إلا في الحدود التي يسمح بها القانون.

تحتفظ بملكية محتواك. وتمنحنا الترخيص الوارد في القسم ٥. ولا يجوز لك استخدام اسم شخص آخر أو صورته دون إذنه.`,
    },
  },
  {
    heading: { en: "9. Disclaimers", ar: "٩. إخلاء المسؤولية" },
    body: {
      en: `The Service is provided "as is" and "as available". We do not warrant that it will be uninterrupted, error-free, or free of harmful components, or that any content on it is accurate, lawful in your jurisdiction, or safe to rely on.

Other users are not under our control. We do not endorse or vouch for them, and their content is theirs, not ours.`,
      ar: `تُقدَّم الخدمة "كما هي" و"كما هي متاحة". ولا نضمن أنها لن تتوقف أو تكون خالية من الأخطاء أو خالية من المكونات الضارة، ولا نضمن أن أي محتوى عليها دقيق أو مشروع في ولايتك القضائية أو آمن للاعتماد عليه.

المستخدمون الآخرون خارج عن سيطرتنا. ولا نؤيدهم ولا نضمن لهم، ومحتواهم ملك لهم لا لنا.`,
    },
  },
  {
    heading: { en: "10. Limitation of liability", ar: "١٠. حدود المسؤولية" },
    body: {
      en: `To the fullest extent the law allows, Ms-Rooms is not liable for indirect, incidental, special, or consequential loss, or for lost profits, lost data, or goodwill. Our total liability to you for any claim arising from the Service is limited to the greater of USD 100, or the total amount you paid to Ms-Rooms in the 12 months before the claim.

Nothing in these terms limits liability that cannot be limited by law, including liability for death or personal injury caused by negligence, or for fraud. Some jurisdictions do not allow certain exclusions, so parts of this section may not apply to you.`,
      ar:`إلى أقصى حد يسمح به القانون، لا تتحمل مسؤولية Ms-Rooms عن أي خسارة غير مباشرة أو عرضية أو خاصة أو تبعية، ولا عن الأرباح أو البيانات أو السمعة المفقودة. وتقتصر مسؤوليتنا الإجمالية عنك على أيهما أكبر بين 100 دولار أمريكي، أو إجمالي ما دفعته إلى Ms-Rooms خلال الاثني عشر شهراً السابقة لتسجيل المطالبة في أي مطالبة ناشئة عن الخدمة.

لا يحد أي مما ورد في هذه الشروط من المسؤولية التي لا يمكن الحدّ منها قانونًا، بما في ذلك المسؤولية عن الوفاة أو الإصابة الجسدية الناتجة عن الإهمال، أو المسؤولية عن الاحتيال. وبعض الولايات القضائية لا تسمح باستثناءات معينة، لذا قد لا ينطبق عليك كل ما ورد في هذا القسم.`,
    },
  },
  {
    heading: { en: "11. Changes to these terms", ar: "١١. تعديل هذه الشروط" },
    body: {
      en: `We may update these terms. When we make a change, we will publish the new version and record it in the app. If the change is material, we will ask you to accept it before you continue using the Service. Continuing to use the Service after a change takes effect means you accept it.`,
      ar: `قد نحدّث هذه الشروط. وعندما نُجري تغييرًا، سننشر النسخة الجديدة ونوثّقها داخل التطبيق. وإذا كان التغيير جوهريًا، فسنطلب منك قبوله قبل أن تستمر في استخدام الخدمة. واستمرارك في استخدام الخدمة بعد سريان التغيير يعني موافقتك عليه.`,
    },
  },
  {
    heading: { en: "12. Governing law and disputes", ar: "١٢. القانون الواجب التطبيق وتسوية المنازعات" },
    body: {
      en: `These terms are governed by the laws of the Arab Republic of Egypt, without regard to conflict-of-law rules. The courts of the Arab Republic of Egypt have exclusive jurisdiction over any dispute, unless the law of your country says you may bring proceedings where you live.

If you are a consumer, this clause does not take away any protection you have under the mandatory law of your country of residence. Contact us: msroomsprod@protonmail.com.`,
      ar:`تخضع هذه الشروط لقوانين جمهورية مصر العربية، دون النظر إلى قواعد تنازع القوانين. وتختص محاكم جمهورية مصر العربية حصريًا بأي نزاع، إلا إذا سمح لك قانون بلدك برفع الدعوى في مكان إقامتك.

وإذا كنت مستهلكًا، فإن هذا البند لا يلغي أي حماية تتمتع بها بموجب القانون الآمر في بلد إقامتك. للتواصل معنا: msroomsprod@protonmail.com.`,
    },
  },
];

/* ---------------------------------------------------------------------------
 * PRIVACY POLICY
 * ------------------------------------------------------------------------- */

const PRIVACY: LegalSection[] = [
  {
    heading: { en: "1. What we collect", ar: "١. البيانات التي نجمعها" },
    body: {
      en: `We collect only what we need to run the Service.

Account data: your user ID, display name, username, avatar, and the sign-in method you used (email, phone, or Google). If you sign in with email we store it; we do not store your password, which is held by our authentication provider.

Content you create: your profile text, messages, gifts, rooms you host, and game scores.

Usage data: which rooms you join and leave, when, your in-call duration, and signal quality events. This is what makes the leaderboards and the moderation tools work.

Technical data: your IP address (stored only as a one-way hash, not in readable form), your browser and device, and records of errors.

Payments: which pack you bought, when, and whether it was settled. We never see or store your card number — the payment provider handles it and returns only a result.`,
      ar: `نجمع فقط ما نحتاجه لتشغيل الخدمة.

بيانات الحساب: معرّف المستخدم واسمه الظاهر واسم المستخدم وصورته الشخصية وطريقة تسجيل الدخول التي استخدمتها (بريد إلكتروني أو رقم هاتف أو حساب Google). وإذا سجّلت الدخول ببريد إلكتروني فنخزّنه، أما كلمة المرور فنحتفظ بمزوّد المصادقة لا نحن.

المحتوى الذي تنشئه: نص ملفك الشخصي ورسائلك وهداياك والغرف التي تستضيفها ونتائج ألعابك.

بيانات الاستخدام: الغرف التي تنضم إليها وتغادرها، وتوقيت ذلك، ومدة مكالمتك، وأحداث جودة الاتصال. هذه البيانات هي ما يجعل لوحات الصدارة وأدوات الإشراف تعمل.

البيانات التقنية: عنوان IP جهازك (ويُخزَّن بصيغة تجزئة غير قابلة للعكس، لا كنص مقروء)، ومتصفحك وجهازك، وسجلات الأخطاء.

المدفوعات: أي باقة اشتريتها ومتى اشتريتها وهل سُوّيت. نحن لا نرى رقم بطاقتك ولا نخزّنه — فمزوّد الدفع هو من يتعامل معه ويعود إلينا بالنتيجة فقط.`,
    },
  },
  {
    heading: { en: "2. How we use your information", ar: "٢. كيف نستخدم معلوماتك" },
    body: {
      en: `We use your data to:
- provide the Service — sign you in, show you rooms, deliver your messages;
- run the parts that need it: leaderboards, matchups, coin balances, and gift records;
- keep the Service safe: detect ban evasion, spam, abuse, and payment fraud;
- improve the product, using aggregated or de-identified figures where we can;
- meet our legal and accounting obligations;
- contact you about your account or the Service, if you have asked us to.

We do not sell your personal information. We do not use your audio for advertising.`,
      ar: `نستخدم بياناتك من أجل:
- تقديم الخدمة — تسجيل دخولك، وعرض الغرف عليك، وتوصيل رسائلك؛
- تشغيل ما يحتاج منها: لوحات الصدارة والمبارزات وأرصدة العملات وسجلات الهدايا؛
- الحفاظ على أمان الخدمة: كشف الالتفاف على الحظر والرسائل المزعجة والإساءة وعمليات الاحتيال المالي؛
- تحسين المنتج، باستخدام أرقام مجمّعة أو منزوعة الهوية كلما أمكن؛
- الوفاء بالتزاماتنا القانونية والمحاسبية؛
- التواصل معك بشأن حسابك أو الخدمة، إذا طلبت ذلك.

نحن لا نبيع معلوماتك الشخصية. ولا نستخدم صوتك في الإعلانات.`,
    },
  },
  {
    heading: { en: "3. Legal basis", ar: "٣. الأساس القانوني" },
    body: {
      en: `Where the GDPR or an equivalent law applies, we rely on:
- contract — to provide the Service you signed up for;
- legitimate interests — to keep the Service secure and running, and to improve it;
- consent — for optional analytics and marketing, which you can withdraw;
- legal obligation — to keep transaction records we are required to keep.

Where consent is the basis, you can withdraw it at any time without affecting what we did before.`,
      ar: `حيثما ينطبق قانون حماية البيانات الشخصية أو ما يعادله، نستند إلى:
- العقد — لتقديم الخدمة التي سجّلت من أجلها؛
- المصالح المشروعة — للحفاظ على أمان الخدمة وتشغيلها وتحسينها؛
- الموافقة — للتحليلات والتسويق الاختياريين، ويمكنك سحبها في أي وقت؛
- الالتزام القانوني — للاحتفاظ بسجلات المعاملات التي يفرض القانون علينا الاحتفاظ بها.

وحيثما تكون الموافقة هي الأساس، يمكنك سحبها في أي وقت دون أن يؤثر ذلك على ما قمنا به من قبل.`,
    },
  },
  {
    heading: { en: "4. Cookies and local storage", ar: "٤. ملفات تعريف الارتباط والتخزين المحلي" },
    body: {
      en: `We set a session cookie when you sign in, and a CSRF token that your browser sends back with each request. Without them you cannot stay signed in.

We store small amounts of data in your browser's local storage — your theme, your draft messages, and your consent record.

We do not run advertising trackers or cross-site behavioural advertising.`,
      ar: `نضع ملف تعريف ارتباط (كوكي) للجلسة عند تسجيل دخولك، ونضع كذلك رمز حماية من التزوير (CSRF) يرسله متصفحك مع كل طلب. وبدونهما لا يمكنك البقاء مسجّل الدخول.

ونخزّن كميات صغيرة من البيانات في التخزين المحلي للمتصفح — مثل السمة، ورسائلك المسودات، وسجل موافقتك.

لا نستخدم أدوات تتبّع إعلانية ولا إعلانات سلوكية عبر المواقع.`,
    },
  },
  {
    heading: { en: "5. Sharing and disclosure", ar: "٥. المشاركة والإفصاح" },
    body: {
      en: `We share your information only with:
- service providers who host our infrastructure, deliver email, or process payments — each bound to use it only for us;
- authorities, where the law requires it, or where we must respond to a valid legal process;
- another party, if we sell or transfer the business, in which case we will tell you first.

Publicly visible parts of your profile — your display name, username, avatar, and anything you choose to show — are visible to other users and, like any social platform, may be copied by them. Do not put anything private in it.

We do not share your personal information for others' marketing.`,
      ar: `نشارك معلوماتك فقط مع:
- مزوّدي الخدمة الذين يستضيفون بنيتنا التحتية أو يسلّمون البريد الإلكتروني أو يعالجون المدفوعات — ويمتلزم كل منهم باستخدامها لخدمتنا فقط؛
- الجهات المختصة، إذا فرض القانون ذلك، أو إذا اضطررنا للرد على إجراء قانوني صحيح؛
- طرف آخر، إذا بعنا العمل أو نقلناه، وفي هذه الحالة سنُخطر أولاً.

الأجزاء العلنية من ملفك الشخصي — اسمك الظاهر واسم المستخدم وصورتك وكل ما تختار إظهاره — تكون مرئية للمستخدمين الآخرين، وكما في أي منصة اجتماعية قد ينسخها غيرك. فلا تضع فيها أي شيء خاص.

لا نشارك معلوماتك الشخصية لأغراض تسويق الآخرين.`,
    },
  },
  {
    heading: { en: "6. How long we keep it", ar: "٦. مدة الاحتفاظ" },
    body: {
      en: `Account data is kept while your account is open. Transaction and coin records are kept for the period the law requires us to keep them for accounting. Moderation records (reports, actions taken) are kept for as long as the account exists plus a limited period afterwards, so that repeat offenders cannot evade a ban by making a new account. Error logs are kept for 30 days. You can request deletion of your account at any time.`,
      ar: `تُحفظ بيانات الحساب طوال فترة بقاء حسابك مفتوحًا. وتُحفظ سجلات المعاملات والعملات للمدة التي يفرضها القانون علينا للاحتفاظ بها للمحاسبة. وتُحفظ سجلات الإشراف (البلاغات والإجراءات المتخذة) طوال فترة وجود الحساب مع مدة محدودة بعده، حتى لا يتمكّن المحظور من إنشاء حساب جديد للتحايل على الحظر. وتُحفظ سجلات الأخطاء ٣٠ يومًا. ويمكنك طلب حذف حسابك في أي وقت.`,
    },
  },
  {
    heading: { en: "7. Security", ar: "٧. الأمان" },
    body: {
      en: `We encrypt traffic in transit and store cardholder data never, because it never reaches us. Passwords are hashed by our authentication provider and are never visible to us. Administrative access is limited to the people who need it and is logged.

No system is perfect. If a breach affects your data, we will tell you and the relevant authority as the law requires.`,
      ar: `نعمّل تشفيرًا للاتصالات أثناء نقلها، ولا نخزّن بيانات حامل البطاقة إطلاقًا لأنها لا تصلنا أصلًا. وتُخزَّن كلمات المرور مُجزَّأة لدى مزوّد المصادقة ولا تكون مرئية لنا. ويقصر الوصول الإداري على من يحتاجه فقط، ويُسجَّل كل وصول.

لا يوجد نظام خالٍ من الثغرات. وإذا أثّر اختراق على بياناتك، فسنُعلمك وسنُعلم الجهة المختصة وفق ما يقتضيه القانون.`,
    },
  },
  {
    heading: { en: "8. Your rights", ar: "٨. حقوقك" },
    body: {
      en: `You have the right to:
- access a copy of your personal data;
- correct anything inaccurate;
- delete your account and data;
- object to, or restrict, certain processing;
- receive your data in a portable format;
- withdraw consent, where we rely on it;
- complain to your data protection authority.

Write to msroomsprod@protonmail.com and we will respond within 30 days. We may ask you to confirm your identity before we act on the request.`,
      ar: `لك الحق في:
- الحصول على نسخة من بياناتك الشخصية؛
- تصحيح أي بيانات غير دقيقة؛
- حذف حسابك وبياناتك؛
- الاعتراض على بعض المعالجات أو تقييدها؛
- استلام بياناتك بصيغة قابلة للنقل؛
- سحب الموافقة، حيثما نقوم عليها؛
- تقديم شكوى إلى جهة حماية البيانات في بلدك.

راسلنا على msroomsprod@protonmail.com وسنرد خلال ٣٠ يومًا. وقد نطلب منك تأكيد هويتك قبل التنفيذ.`,
    },
  },
  {
    heading: { en: "9. Children", ar: "٩. الأطفال" },
    body: {
      en: `The Service is not for anyone under ${MINIMUM_AGE}. We do not knowingly collect data from children. If you believe a child has given us personal data, contact us and we will delete it.`,
      ar: `الخدمة غير موجّهة لمن يقل عن ${MINIMUM_AGE} عامًا. ولا نجمع بيانات من الأطفال عن علم. وإذا رأيت أن طفلًا قد أعطانا بيانات شخصية، فتواصل معنا وسنحذفها.`,
    },
  },
  {
    heading: { en: "10. Where your data is processed", ar: "١٠. مكان معالجة بياناتك" },
    body: {
      en: `Our infrastructure is hosted with Cloudflare. Your data may therefore be processed outside your country, including in the United States. Where data leaves your country, we use recognised transfer safeguards. Contact us for details.`,
      ar: `بُنيتنا التحتية مستضافة لدى Cloudflare. ومن ثم قد تُعالَج بياناتك خارج بلدك، بما في ذلك الولايات المتحدة. وإذا غادرت البيانات بلدك، فإننا نستخدم ضمانات نقل معترفًا بها. تواصل معنا لمعرفة التفاصيل.`,
    },
  },
  {
    heading: { en: "11. Changes and contact", ar: "١١. التعديلات والتواصل" },
    body: {
      en: `When this policy changes we will publish a new version in the app and ask existing users to accept it. Contact Ms-Rooms at msroomsprod@protonmail.com. Registered address: Bait Al Masria, October Gardens, Giza, Egypt.`,
      ar: `عند تعديل هذه السياسة سننشر نسخة جديدة داخل التطبيق ونطلب من المستخدمين الحاليين قبولها. للتواصل مع Ms-Rooms على msroomsprod@protonmail.com. والعنوان المسجل: Bait Al Masria, October Gardens, Giza, Egypt.`,
    },
  },
];

/* ---------------------------------------------------------------------------
 * COMMUNITY GUIDELINES
 * ------------------------------------------------------------------------- */

const GUIDELINES: LegalSection[] = [
  {
    heading: { en: "1. Treat people like people", ar: "١. تعامل مع الناس كبشر" },
    body: {
      en: `Rooms here are social spaces. Be decent to the people in them. Assume good faith, and remember there is a person on the other side of every microphone.

You do not have to agree with everyone, and lively debate is welcome. What is not welcome is going after a person because of who they are.`,
      ar: `الغرف هنا أماكن اجتماعية. كن لطيفًا مع من فيها. افترض حسن النية، وتذكّر أن هناك إنسانًا على الطرف الآخر من كل ميكروفون.

لستَ مضطرًا للموافقة على الجميع، والجدال الحي مرحّب به. لكن التنمر على شخص بسبب صفاته ليس من مرحب به.`,
    },
  },
  {
    heading: { en: "2. No harassment or hate", ar: "٢. لا مضايقة ولا كراهية" },
    body: {
      en: `Do not harass, threaten, stalk, demean, or target anyone. This includes repeated unwanted contact, sexual attention, slurs, and pile-ons.

You cannot hate speech here. Threats of violence, including ones made jokingly, are removed and can lead to a ban. Content that sexualises a minor is reported to the authorities and the account is closed permanently.`,
      ar: `لا تُضايق أحدًا ولا تهدده ولا تلاحقه ولا تتهاون به ولا تستهدفه. ويشمل ذلك الاتصال المتكرر غير المرغوب، والانتباه الجنسي، والألفاظ النابية، وتجمّع الناس ضد شخص.

لا مكان للخطاب الكرهي هنا. وتُحذف تهديدات العنف، بما فيها التي تُقال على سبيل المزاح، وقد تؤدي إلى حظر. أما المحتوى الذي يقدّم قاصرًا بصورة جنسية فيُبلَّغ عنه إلى السلطات ويُغلق الحساب نهائيًا.`,
    },
  },
  {
    heading: { en: "3. Keep it legal", ar: "٣. التزم بالقانون" },
    body: {
      en: `Do not discuss or carry out anything illegal, and do not promote violence, self-harm, or dangerous behaviour. Do not offer or request drugs, weapons, or stolen goods.

If you are in danger, contact local emergency services first. We are not an emergency service.`,
      ar: `لا تناقش أي أمر غير قانوني ولا تنفّذه، ولا تروّج للعنف أو لإيذاء النفس أو للسلوك الخطر. ولا تعرض أو تطلب المخدرات أو الأسلحة أو البضائع المسروقة.

إذا كنت في خطر، فاتصل بخدمات الطوارئ المحلية أولًا. فنحن لسنا خدمة طوارئ.`,
    },
  },
  {
    heading: { en: "4. Do not deceive", ar: "٤. لا تخدع" },
    body: {
      en: `Do not pretend to be someone you are not, do not make false claims about your identity or your intentions, and do not run scams. This includes fake giveaways, phishing, and pretending to be a moderator or member of staff.

If someone messages you claiming to be staff, ask them in the room. Staff will never ask you for your password, your verification codes, or payment.`,
      ar: `لا تتظاهر بأنك شخص آخر، ولا تدّعِ زائفًا عن هويتك أو عن نواياك، ولا تُقدّم عمليات احتيال. ويشمل ذلك السحوبات الوهمية والتصيّد الاحتيالي والتظاهر بأنك مشرف أو موظف.

إذا راسلك أحدهم مدّعيًا أنه موظف، فاسأله داخل الغرفة. لن يطلب الموظفون أبدًا كلمة مرورك أو رموز التحقق أو معلومات الدفع.`,
    },
  },
  {
    heading: { en: "5. No spam or unsolicited promotion", ar: "٥. لا رسائل مزعجة أو ترويج غير مرغوب" },
    body: {
      en: `Do not use rooms to advertise other products, drop links, or recruit for your channel. Hosts may remove people who do this; repeated offences lead to account closure.

Sharing something because it genuinely fits the conversation is fine. Advertising is not.`,
      ar: `لا تستخدم الغرف للإعلان عن منتجات أخرى أو نشر روابط أو تجنيد أشخاص إلى قناتك. ويستطيع المضيف إزالة من يفعل ذلك، وتؤدي المخالفات المتكررة إلى إغلاق الحساب.

ومشاركة شيء لأنه يناسب الحوار فعلًا أمر حسن. أما الإعلان فلا.`,
    },
  },
  {
    heading: { en: "6. Respect other people's privacy", ar: "٦. احترم خصوصية الآخرين" },
    body: {
      en: `Do not record, screenshot, or share someone else's conversation or stream without their consent. Do not post someone's private messages, phone number, or address.

If you want to record a room, ask the host first and say out loud that you are doing it.`,
      ar: `لا تسجّل محادثة شخص آخر أو بثه أو تصوره أو تشاركه دون موافقته. ولا تنشر رسائله الخاصة أو رقم هاتفه أو عنوانه.

وإذا أردت تسجيل غرفة، فاسأل المضيف أولًا واذكر بصوت مسموع أنك تفعل ذلك.`,
    },
  },
  {
    heading: { en: "7. Rooms run by their hosts", ar: "٧. الغرف يديرها مضيفوها" },
    body: {
      en: `A host sets the tone of their room and can mute, remove, or lock out anyone. Follow their reasonable instructions. Do not use mute or removal as a decision you make about someone in advance — take the action, or ask a moderator.

Muting is a tool, not a punishment.`,
      ar: `المضيف يحدد طابع غرفته ويستطيع كتم أي شخص أو إخراجه أو منعه من الدخول. واتبع تعليماته المعقولة. لا تستخدم الكتم أو الإخراج حكمًا تقرره على شخص قبل وقوع الأمر — إمّا أن تتخذ الإجراء، أو تطلب من مشرف.

الكتم أداة، لا عقوبة.`,
    },
  },
  {
    heading: { en: "8. Moderation, appeals, and reporting", ar: "٨. الإشراف والاعتراض والبلاغات" },
    body: {
      en: `If something is wrong, report it from the profile menu or the room. Reports go to the moderation team, and serious threats are escalated.

Actions can include a mute, a temporary suspension, a permanent ban, or removal of content. If you think we got it wrong, write to msroomsprod@protonmail.com from the email on your account. We look again. Banning for serious abuse or child safety is not reversible.

We act on reports in good faith. Reporting someone to cause them trouble is itself a breach of these guidelines.`,
      ar: `إذا كان هناك خطأ ما، فبلّغ عنه من قائمة الملف الشخصي أو من الغرفة. وتذهب البلاغات إلى فريق الإشراف، وتُصعَّد التهديدات الجسيمة.

وقد تشمل الإجراءات كتمًا أو تعليقًا مؤقتًا أو حظرًا دائمًا أو إزالة محتوى. وإذا رأيت أننا أخطأنا، فاكتب إلى msroomsprod@protonmail.com من البريد المسجل في حسابك. وسننظر في الأمر. أما الحظر بسبب إساءة استخدام جسيمة أو حماية طفل فلا يُقَلَب.

نتصرف بناءً على البلاغات بنية حسنة. والإبلاغ عن شخص بغية الإضرار به يُعدّ في حد ذاته إخلالًا بهذه الإرشادات.`,
    },
  },
];

/* ---------------------------------------------------------------------------
 * REGISTRY
 * ------------------------------------------------------------------------- */

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    key: "terms",
    version: LEGAL_VERSION,
    title: { en: "Terms of Service", ar: "شروط الخدمة" },
    summary: {
      en: "The rules for using MS-ROOMS, including accounts, coins, payments, and refunds.",
      ar: "قواعد استخدام MS-ROOMS، بما في ذلك الحسابات والعملات والمدفوعات والاسترداد.",
    },
    sections: TERMS,
  },
  {
    key: "privacy",
    version: LEGAL_VERSION,
    title: { en: "Privacy Policy", ar: "سياسة الخصوصية" },
    summary: {
      en: "What we collect, why we collect it, how long we keep it, and your rights over it.",
      ar: "ما الذي نجمعه، ولماذا، وكم نحتفظ به، وحقوقك عليه.",
    },
    sections: PRIVACY,
  },
  {
    key: "guidelines",
    version: LEGAL_VERSION,
    title: { en: "Community Guidelines", ar: "إرشادات المجتمع" },
    summary: {
      en: "How to behave in rooms so that everyone here has a good time and stays safe.",
      ar: "كيف تتصرف في الغرف ليتمتع الجميع بوقته ويظل آمنًا.",
    },
    sections: GUIDELINES,
  },
];

/** Look up a document by key. */
export function getLegalDocument(key: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((d) => d.key === key);
}

/** Flatten a document to plain text in one language — used for the stored copy. */
export function renderLegalDocument(doc: LegalDocument, lang: LegalLang): string {
  const parts = [`${doc.title[lang]} (v${doc.version})`, ""];
  for (const s of doc.sections) {
    parts.push(s.heading[lang], s.body[lang], "");
  }
  return parts.join("\n");
}

/** True when the language is one we actually ship. */
export function isLegalLang(value: unknown): value is LegalLang {
  return typeof value === "string" && (LEGAL_LANGS as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------------------
 * THE GATE
 * ------------------------------------------------------------------------- */

export interface AcceptedRecord {
  doc_key: string;
  doc_version: string;
}

/**
 * Which required documents are still outstanding at `version`.
 *
 * The rule is that a user is cleared only when EVERY required document has
 * been accepted AT THE CURRENT VERSION. Both halves matter:
 *
 *   * "every" — partial acceptance is not clearance. A user who ticked the
 *     privacy box but not the terms has not agreed to the terms, and must not
 *     be treated as though they had.
 *   * "at the current version" — agreeing to last year's terms is not agreeing
 *     to today's. When the text is revised and the version is bumped, everyone
 *     falls out of clearance automatically and is asked again. That is the
 *     only way a version bump can actually mean anything.
 *
 * Pure, and shared: the client uses it to render the outstanding list, the
 * server uses it to decide whether to let someone through. One rule, one
 * implementation, so the check that guards the door and the check that
 * renders the form cannot disagree.
 */
export function missingLegalDocs(accepted: readonly AcceptedRecord[], version = LEGAL_VERSION): LegalDocKey[] {
  const have = new Set(
    accepted.filter((a) => a.doc_version === version).map((a) => a.doc_key)
  );
  return REQUIRED_LEGAL_DOCS.filter((k) => !have.has(k));
}

/** True when the user is cleared to use the product at `version`. */
export function isLegalCleared(
  accepted: readonly AcceptedRecord[],
  version = LEGAL_VERSION
): boolean {
  return missingLegalDocs(accepted, version).length === 0;
}

/**
 * Metadata the client needs to render the consent gate, without shipping the
 * document bodies. Public and unauthenticated by design — someone deciding
 * whether to sign up must be able to read what they are agreeing to first.
 */
export interface LegalDocSummary {
  key: LegalDocKey;
  version: string;
  title: string;
  summary: string;
  section_count: number;
}

export function legalDocSummaries(lang: LegalLang): LegalDocSummary[] {
  return LEGAL_DOCUMENTS.map((d) => ({
    key: d.key,
    version: d.version,
    title: d.title[lang],
    summary: d.summary[lang],
    section_count: d.sections.length,
  }));
}