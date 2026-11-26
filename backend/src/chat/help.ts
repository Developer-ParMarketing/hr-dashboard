/**
 * "How do I...?" answers about the HR portal itself, for the chatbot.
 * Keep this in sync when a screen or flow changes. Each topic has keywords the
 * question is matched against (whole words, English + common Hinglish).
 */

type HelpTopic = {
    title: string;
    keywords: string[];
    /** who can use it (shown in the answer) */
    who?: string;
    steps: string[];
    note?: string;
};

const TOPICS: HelpTopic[] = [
    {
        title: "Apply for leave",
        keywords: ["leave", "chutti", "pl", "sl", "cl", "apply leave", "leave request", "sick", "casual"],
        who: "every employee",
        steps: [
            "Open **Leave request** in the left menu (under Requests).",
            "Choose the type - **PL** (personal), **SL** (sick) or **CL** (casual) - and the dates.",
            "Each type shows how many days you have **left** - you can't apply for more than that (pending requests count too).",
            "Add a short reason and submit. Your manager / approver gets it for approval.",
            "Once approved, the leave shows on your attendance automatically.",
        ],
        note: "PL needs approval at least 24 hours before it starts; SL/CL before the first half of the same day (see Policies -> Leaves & work from home).",
    },
    {
        title: "Missed punch / WFH punch (In/out request)",
        keywords: ["in/out", "in out", "inout", "missed punch", "forgot punch", "punch request", "correction", "wfh punch", "work from home", "wfh"],
        who: "every employee",
        steps: [
            "Open **In/out request** in the left menu (under Requests).",
            "Pick the date and enter the IN and OUT time (both inside your shift for WFH).",
            "Add the reason (missed punch / work from home) and submit.",
            "After approval the times are applied to that day in attendance.",
        ],
    },
    {
        title: "Claim an expense (Reimbursement)",
        keywords: ["reimbursement", "expense", "claim", "bill", "receipt", "travel"],
        who: "every employee",
        steps: [
            "Open **Reimbursement** in the left menu.",
            "Enter the amount, date and purpose, and attach the receipt.",
            "Submit - it goes to your approver; you can see the status on the same page.",
        ],
    },
    {
        title: "See attendance (Attendance history)",
        keywords: ["attendance", "history", "register", "punch", "my attendance", "monthly", "weekly", "daily", "hours", "deficit"],
        steps: [
            "Open **Attendance history** in the left menu and pick the month.",
            "Monthly / Weekly / Daily views show each day; click **Details** next to a name for the full month, or click a day cell for that day's punch-in, punch-out and hours.",
            "Colours: green = present, orange **HD** = present but under 5 hours, red = absent, blue = WFH, violet = paid leave, grey = weekly off. An amber ring means late.",
        ],
        note: "Punches come from the door machines automatically every 15 minutes.",
    },
    {
        title: "How attendance gets into the system (HR)",
        keywords: ["sync", "machine", "essl", "upload", "biometric", "door", "register upload"],
        who: "HR / admin",
        steps: [
            "Door-machine (eSSL) punches sync automatically every 15 minutes - nothing to upload.",
            "On **Attendance**, **Sync from machine** pulls the latest punches right now.",
            "WFH and leave files can be uploaded on the same page (Apply leave / WFH files).",
            "Corrections: edit a day in Attendance history, or approve an In/out request.",
        ],
    },
    {
        title: "Approve requests (managers / HR)",
        keywords: ["approve", "approval", "pending", "reject"],
        who: "Managers, HR and admin",
        steps: [
            "Pending leave, in/out and reimbursement requests show on the **Dashboard** and in the bell.",
            "Open the request page (Leave request / In/out request / Reimbursement) to approve or reject.",
            "Monthly attendance is approved for payroll in **Attendance history -> Monthly** (select employees -> Approve monthly).",
        ],
    },
    {
        title: "Holidays",
        keywords: ["holiday", "holidays", "festival", "off day"],
        steps: ["Open **Holiday list** in the left menu - it shows all company holidays for the year (full and half days)."],
    },
    {
        title: "Company & attendance policies",
        keywords: ["policy", "policies", "rules", "manage policy", "add policy"],
        steps: [
            "Open **Policies** in the left menu - Attendance and Company tabs. You can download them as PDF.",
            "HR / admin: click **Manage policies** to add, edit, reorder or hide a section. Changes are live at once (and in this chatbot).",
        ],
    },
    {
        title: "Goal sheet",
        keywords: ["goal", "goals", "goal sheet", "kra", "target"],
        steps: [
            "Open **Goal sheet** in the left menu.",
            "**My goal sheet** - fill and submit your goals (every January; new joiners after the 3-month probation, within 1 month).",
            "**Team reviews** - managers rate their team. **Management review** - leadership gives the final rating.",
            "**All goal sheets** - HR sees everyone's status.",
        ],
    },
    {
        title: "Performance appraisal",
        keywords: ["appraisal", "performance", "review", "increment", "self assessment"],
        steps: [
            "Open **Performance appraisal** in the left menu.",
            "Tabs: My appraisal, Team reviews, Management review, All appraisals.",
            "Your appraisal opens 1 month before your joining-date anniversary.",
        ],
    },
    {
        title: "Offer letter",
        keywords: ["offer", "offer letter", "candidate", "joining", "joining forms"],
        who: "HR / admin (and people given offer-letter access)",
        steps: [
            "Open **Offer letter**. Add candidates with **+ Add row** or **Import Excel**.",
            "Check the email and the PDF preview, then **Send**. Management is CC'd and the Par Marketing Joining Forms workbook is attached.",
        ],
    },
    {
        title: "Relieving / experience letter",
        keywords: ["relieving", "experience letter", "exit", "resign", "resignation", "full and final"],
        who: "HR / admin",
        steps: [
            "Open **Relieving letter** and pick the employee (people who left are marked \"left\").",
            "Check the dates, upload the digital signature (PNG/JPEG), then **Download PDF** or **Send letter by email**.",
        ],
        note: "Downloading or sending the letter marks the employee as leaving on the date of leaving.",
    },
    {
        title: "Salary / payroll (HR)",
        keywords: ["salary", "payroll", "pay", "calculate salary", "salary sheet"],
        who: "HR / admin",
        steps: [
            "Approve the month's attendance first (Attendance history -> Monthly -> Approve monthly).",
            "Open **Salary** -> monthly sheet -> calculate payroll, then check results and export.",
        ],
        note: "Pay slip, Tax information, TDS and Form 16 pages are coming soon.",
    },
    {
        title: "Leave not approved yet / stuck",
        keywords: ["not approved", "pending", "stuck", "approve", "approval", "manager not", "ticket", "reject", "rejected", "approve nahi", "approve nhi"],
        who: "every employee",
        steps: [
            "Open **Leave request -> My requests** and check the status and **Pending with** (who has to approve it).",
            "Remind that person (your manager). If your manager is away, **HR / admin can approve or reject it** directly.",
            "If it is still not approved, raise a ticket with HR: email **hr@parmarketing.agency** with your name, code and the leave dates.",
            "If it was rejected, the reason is shown in **My requests**; you can apply again with the right type or dates.",
        ],
    },
    {
        title: "Leave balance",
        keywords: ["balance", "leave balance", "leaves left", "remaining", "kitni leave", "kitni chhutti"],
        who: "every employee",
        steps: [
            "Open **Leave request -> Balance** to see PL, SL and CL for this year: total, used, pending and left.",
            "Or ask me: \"how many leaves do I have left?\"",
        ],
        note: "Yearly: 12 PL, 6 SL, 6 CL (half credited in January, half in July). Unused leave does not carry to the next year.",
    },
    {
        title: "Pay slip, tax, TDS and Form 16",
        keywords: ["payslip", "pay slip", "slip", "salary slip", "tax", "tds", "form 16", "form16", "itr"],
        steps: [
            "These pages are in the left menu under Payroll: **Pay slip**, **Tax information**, **TDS deduction** and **Form 16**.",
            "They are marked **Coming soon** - for now, please ask HR for your pay slip or tax documents.",
        ],
    },
    {
        title: "Employees, logins and teams (Admin)",
        keywords: ["add employee", "new employee", "employee", "login", "access", "team", "manager", "assign", "deactivate", "inactive", "active"],
        who: "HR / admin",
        steps: [
            "Open **Admin -> People** to add or edit an employee (code, name, work email, DOJ, salary, team, login).",
            "Tick **Can log in to this system** and set a password to give someone a login.",
            "**Admin -> Teams** assigns members to managers.",
            "To bring back someone who left: clear the date of leaving, set Status = Active and save - their login is switched on again.",
        ],
    },
    {
        title: "Password and login",
        keywords: ["password", "forgot", "reset", "login", "sign in", "locked"],
        steps: [
            "Forgot it? Use **Forgot password** on the login page, or ask HR to set a new one (Admin -> People -> Edit -> Reset password).",
            "Sign in with your **work email** (the one on your employee record).",
        ],
    },
    {
        title: "What this chatbot can do",
        keywords: ["help", "what can you do", "chatbot", "assistant", "features", "kya kar sakte"],
        steps: [
            "Attendance: today's punch-ins, who is late / absent / not punched in, anyone's month or week (as allowed for your role).",
            "Monthly totals and rankings (most late marks, lowest hours), managers and teams, leave requests, pending approvals.",
            "Holidays, company and attendance policies, and how to use any page of this portal.",
        ],
        note: "HR sees everyone, managers see their team, employees see only their own data.",
    },
];

const STOP = new Set(["how", "to", "do", "i", "the", "a", "an", "can", "where", "is", "what", "my", "me", "kaise", "kare", "karu", "kya", "hai", "please", "for", "in", "of"]);

/** Best-matching help topics for a question (up to 2). */
export function findHelp(question: string): { title: string; markdown: string }[] {
    const q = ` ${question.toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ")} `;
    const words = q.trim().split(" ").filter((w) => w.length >= 2 && !STOP.has(w));
    const scored = TOPICS.map((t) => {
        let score = 0;
        for (const k of t.keywords) {
            if (k.includes(" ") || k.includes("/")) {
                if (q.includes(` ${k} `)) score += 3;
            } else if (words.includes(k)) {
                score += 2;
            }
        }
        if (q.includes(t.title.toLowerCase())) score += 3;
        return { t, score };
    })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
    if (scored.length === 0) return [];
    const best = scored[0]!.score;
    return scored
        .filter((x) => x.score >= best - 1)
        .slice(0, 2)
        .map(({ t }) => ({
            title: t.title,
            markdown: [
                `**${t.title}**${t.who ? ` (for ${t.who})` : ""}`,
                ...t.steps.map((s, i) => `${i + 1}. ${s}`),
                ...(t.note ? [`Note: ${t.note}`] : []),
            ].join("\n"),
        }));
}

export function helpTopicTitles(): string[] {
    return TOPICS.map((t) => t.title);
}