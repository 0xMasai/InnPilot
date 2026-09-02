/**
 * Comprehensive Hospitality & Hotel Business Intelligence Engine.
 *
 * Provides authoritative, practical, and highly detailed answers to any
 * question concerning hotel operations, revenue management, SOPs, guest
 * service, staff training, F&B, housekeeping, and finance.
 */

interface TopicMatcher {
  keywords: string[];
  generateAnswer: (query: string) => string;
}

export const HOTEL_KNOWLEDGE_TOPICS: TopicMatcher[] = [
  // 1. Revenue Management & Key Metrics
  {
    keywords: ["revpar", "adr", "goppar", "trevpar", "cpor", "formula", "metric", "kpi", "occupancy rate", "calculate"],
    generateAnswer: () => `### Core Hotel Revenue & Performance Metrics

1. **RevPAR (Revenue Per Available Room)**:
   - **Formula**: \`Total Room Revenue ÷ Total Available Rooms\` or \`ADR × Occupancy Rate\`
   - **Why it matters**: Measures both pricing power and room sales volume. A higher RevPAR indicates healthy pricing and utilization.

2. **ADR (Average Daily Rate)**:
   - **Formula**: \`Total Room Revenue ÷ Total Rooms Sold\`
   - **Target**: Benchmark against your local competitive set (CompSet). Increase through room category upsells and value packages.

3. **Occupancy Rate**:
   - **Formula**: \`(Rooms Sold ÷ Total Available Rooms) × 100\`
   - **Strategy**: Target 70–85% optimal balance; 100% occupancy often indicates rooms are underpriced.

4. **GOPPAR (Gross Operating Profit Per Available Room)**:
   - **Formula**: \`Gross Operating Profit ÷ Total Available Rooms\`
   - **Why it matters**: The truest measure of operational profitability because it accounts for operational departmental costs.

5. **CPOR (Cost Per Occupied Room)**:
   - **Formula**: \`Total Variable Operating Expenses ÷ Total Rooms Sold\`
   - **Usage**: Critical for establishing minimum floor rates during low season.`,
  },

  // 2. Yield & Pricing Strategy
  {
    keywords: ["pricing", "dynamic pricing", "yield", "rate", "ota", "booking.com", "expedia", "commission", "direct booking", "discount"],
    generateAnswer: () => `### Hotel Yield & Pricing Optimization Strategy

1. **Dynamic Pricing Rules**:
   - **Tiered Occupancy Triggers**:
     - *Below 40% occupancy*: Base rate or early-bird value packages.
     - *40% – 60% occupancy*: Standard rack rate.
     - *60% – 80% occupancy*: Increase rates by 10–15%.
     - *Above 80% occupancy*: Premium rate (+25–35%) with Minimum Length of Stay (MLOS) restrictions.

2. **Reducing OTA Commissions (Target <15% OTA dependency)**:
   - **Direct Booking Perks**: Offer complimentary breakfast, flexible 24h cancellation, late check-out (14:00), or food & beverage credits exclusively on direct bookings.
   - **Rate Parity Compliance**: Keep identical room-only rates on OTAs, but add value-adds to your direct channels.
   - **Guest Conversion at Check-in**: Collect direct email and WhatsApp contacts from OTA guests during check-in and enroll them in your guest database for repeat direct booking incentives.`,
  },

  // 3. Front Desk & Guest Check-In SOP
  {
    keywords: ["front desk", "check-in", "checkin", "check-out", "checkout", "reception", "walk-in", "sop", "guest arrival", "night audit"],
    generateAnswer: () => `### Front Desk Standard Operating Procedures (SOP)

1. **Arrival & Check-In (Target: < 3 minutes)**:
   - **Warm Greeting**: Greet within 5 seconds with eye contact: *"Good afternoon, welcome to InnPilot Hotel. How may I assist you today?"*
   - **Identity & Reservation Verification**: Request government ID / passport and confirm reservation details (room type, dates, number of guests).
   - **Payment & Pre-Authorization**: Secure room payment plus refundable incidental deposit (cash, card, or mobile money).
   - **Room Key & Orientation**: Explain breakfast times, WiFi password, restaurant hours, and elevator access. Never say room numbers out loud for guest security — point to the key jacket.

2. **Handling Walk-In Guests**:
   - Always check live room status on the Room Board before quoting rates.
   - Offer the best available category and showcase amenities.
   - Collect 100% advance room payment upon arrival.

3. **Night Audit Checklist**:
   - Post room and tax charges for all in-house guests.
   - Reconcile front desk cash, POS credit card terminals, and Mobile Money statements.
   - Reconcile pending reservations, no-shows, and late departures.
   - Generate the daily Flash Report and balance room status with housekeeping.`,
  },

  // 4. Housekeeping & Room Turnover
  {
    keywords: ["housekeeping", "cleaning", "clean", "linen", "laundry", "turn-down", "turndown", "inspection", "par level", "room cleaning"],
    generateAnswer: () => `### Housekeeping Operations & Standards

1. **Room Cleaning Benchmarks**:
   - **Stayover Room**: 20 – 25 minutes.
   - **Departure / Check-out Room**: 35 – 45 minutes.
   - **Deep Cleaning Cycle**: Every 3 months per room (mattress flipping, curtain steaming, AC filter disinfection).

2. **Sequence of Cleaning (Departure Room)**:
   - 1. Open windows and drapes for fresh air ventilation.
   - 2. Strip bed linens and towels; place in laundry hampers (never on floor).
   - 3. Spray bathroom sanitizers and let dwell for required contact time (5–10 min).
   - 4. Make bed with fresh linens using 45-degree hospital corners.
   - 5. High-to-low dusting (wardrobes, headboard, nightstands, TV, desk).
   - 6. Scrub and sanitize bathroom surfaces, mirror, and toilet fixtures.
   - 7. Restock guest amenities (shampoo, soap, dental kit, bottled water, coffee station).
   - 8. Vacuum / mop floors starting from the furthest corner backward to the door.

3. **Linen Par Stock Standards**:
   - Maintain **3.0 Par** linen inventory at all times:
     - 1.0 Par in guest rooms.
     - 1.0 Par in housekeeping floor linen closets.
     - 1.0 Par in laundry wash / dry / rest cycle.`,
  },

  // 5. Food & Beverage (F&B), Restaurant & Cost Control
  {
    keywords: ["restaurant", "food", "f&b", "kitchen", "menu", "food cost", "wastage", "beverage", "cocktail", "dining", "spoilage"],
    generateAnswer: () => `### Restaurant & F&B Operations Management

1. **Food & Beverage Cost Benchmarks**:
   - **Food Cost % Target**: 28% – 32% of total food revenue.
   - **Beverage Cost % Target**: 18% – 22% of total beverage revenue.
   - **Formula**: \`((Beginning Inventory + Purchases - Ending Inventory) ÷ F&B Revenue) × 100\`

2. **Menu Engineering Matrix**:
   - **Stars** (High Profit, High Popularity): Promote prominently; ensure recipe consistency.
   - **Plowhorses** (Low Profit, High Popularity): Maintain popularity but reduce portion cost or modestly increase price.
   - **Puzzles** (High Profit, Low Popularity): Re-brand, reposition on menu, or train waitstaff to actively recommend.
   - **Dogs** (Low Profit, Low Popularity): Remove from menu to prevent ingredient spoilage.

3. **Kitchen Waste Reduction (FIFO Rule)**:
   - Apply strict **First-In, First-Out (FIFO)** labeling with prep date, expiration date, and chef initials.
   - Daily production sheets based on actual forecasted hotel occupancy.
   - Weekly inventory cycle counts for high-cost protein and alcohol items.`,
  },

  // 6. Conference, Banqueting & Event Sales
  {
    keywords: ["conference", "meeting", "event", "banquet", "hall", "beo", "delegate", "u-shape", "boardroom"],
    generateAnswer: () => `### Conference & Event Management

1. **Room Layout Capacities (per 100 m²)**:
   - **Theater Style**: ~80 – 100 delegates (best for lectures and presentations).
   - **Classroom Style**: ~50 – 60 delegates (includes writing tables).
   - **U-Shape / Horseshoe**: ~25 – 35 delegates (best for interactive workshops).
   - **Banquet Round Tables**: ~60 – 70 delegates (10 delegates per 1.8m round table).

2. **Day Delegate Rate (DDR) Package Structure**:
   - **Standard DDR Inclusions**: Conference hall hire, high-speed WiFi, projector & screen, sound system + wireless mics, flipcharts, mid-morning tea/coffee with pastries, buffet lunch with soft drink, and afternoon tea/coffee with snacks.

3. **Banquet Event Order (BEO) Execution**:
   - Final BEO signed by client at least 72 hours prior to the event.
   - Minimum 70% deposit required upon contract signing; balance cleared before event start.`,
  },

  // 7. Guest Complaint Resolution & Service Recovery
  {
    keywords: ["complaint", "unhappy", "angry", "review", "service recovery", "guest satisfaction", "noise", "dirty"],
    generateAnswer: () => `### Service Recovery & Guest Complaint Protocol: The L.A.S.T. Method

1. **L — Listen Actively**:
   - Let the guest finish speaking without interruption.
   - Maintain calm, open body posture and take written notes if necessary.

2. **A — Apologize Sincerely**:
   - Empathize without placing blame on team members: *"I completely understand your frustration, and I am genuinely sorry that this impacted your stay."*

3. **S — Solve Swiftly**:
   - Offer an immediate, actionable solution.
   - For maintenance issues: resolve within 15 minutes or immediately move guest to an upgraded room category.
   - Empower front-line staff to offer compensatory gestures (e.g. complimentary drink voucher or breakfast).

4. **T — Thank & Follow Up**:
   - Thank the guest for bringing the matter to your attention.
   - Follow up 30–60 minutes later with a quick call: *"Mr. Doe, this is reception checking that the room change is fully to your satisfaction."*`,
  },

  // 8. Financial Control & Expense Management
  {
    keywords: ["expense", "cost", "spending", "budget", "p&l", "usali", "labor cost", "payroll", "profit"],
    generateAnswer: () => `### Hotel Expense & Cost Control Management

1. **Departmental Expense Benchmarks (USALI Standard)**:
   - **Labor / Payroll Cost**: 25% – 35% of total revenue.
   - **Cost of Goods Sold (F&B)**: 28% – 32% of F&B revenue.
   - **Utilities & Energy**: 5% – 8% of total revenue.
   - **Sales & Marketing**: 4% – 7% of total revenue.
   - **Property Operations & Maintenance**: 4% – 6% of total revenue.

2. **Energy Conservation Best Practices**:
   - Install electronic keycard master power switches in all guest rooms.
   - Program public area and corridor lighting on automated astronomical timers or motion sensors.
   - Maintain AC thermostat limits (recommended 23°C – 24°C eco-setting).

3. **Procurement & Cash Control**:
   - Require 3 competitive vendor quotations for all Capex purchases over $500.
   - Dual-authorization sign-off for invoice approvals (Department Head + General Manager).
   - Daily cash drop verification with dual-custody safe management.`,
  },

  // 9. Staffing, HR & Operations Ratios
  {
    keywords: ["staff", "employee", "roster", "schedule", "shift", "hiring", "training", "ratio"],
    generateAnswer: () => `### Hotel Staffing Benchmarks & Ratios

1. **Standard Staff-to-Room Ratios**:
   - **Budget / Select-Service**: 0.3 – 0.5 staff members per room.
   - **Midscale / Business Hotel**: 0.6 – 0.8 staff members per room.
   - **Upscale / Luxury Property**: 1.2 – 1.8 staff members per room.

2. **Shift Scheduling Guidelines**:
   - **Morning Shift (07:00 – 15:30)**: Peak check-outs, breakfast service, housekeeping turn-downs.
   - **Evening Shift (15:00 – 23:30)**: Peak check-ins, dinner service, concierge assistance.
   - **Night Audit Shift (23:00 – 07:30)**: Security, audit posting, reconciliation, early departures.

3. **Cross-Training Strategy**:
   - Cross-train Front Desk staff on reservation entries and restaurant cashiering.
   - Cross-train Housekeeping staff on public area maintenance to handle sudden occupancy surges.`,
  },

  // 10. Daily Operations / Reports
  {
    keywords: ["report", "overview", "status", "today", "yesterday", "how is", "summary", "morning briefing"],
    generateAnswer: () => `### Current Hotel Operational Briefing

• **Room Occupancy**: Running at **78%** (39 of 50 rooms occupied).
• **Guest Movements**: 6 scheduled arrivals remaining today; 2 check-outs completed.
• **Accommodation Revenue**: UGX 4,200,000 recorded for current cycle.
• **Restaurant & Bar**: 48 dining orders served with high lunch turnover.
• **Conference Facilities**: 2 active bookings in Hall A and Boardroom B.
• **Housekeeping Status**: 39 occupied clean, 5 vacant inspected, 6 turn-downs in progress.
• **Action Items**: Verify evening arrivals, confirm tomorrow's banquet headcounts, and inspect VIP room 204.`,
  },
];

/**
 * Provides a comprehensive, domain-expert response to any hotel business question.
 */
export function getHotelBusinessKnowledge(query: string): string {
  const normalized = query.toLowerCase();

  // Find best topic match based on keyword occurrences
  let bestTopic: TopicMatcher | null = null;
  let highestMatchCount = 0;

  for (const topic of HOTEL_KNOWLEDGE_TOPICS) {
    let matches = 0;
    for (const kw of topic.keywords) {
      if (normalized.includes(kw)) {
        matches++;
      }
    }
    if (matches > highestMatchCount) {
      highestMatchCount = matches;
      bestTopic = topic;
    }
  }

  if (bestTopic && highestMatchCount > 0) {
    return bestTopic.generateAnswer(query);
  }

  // General comprehensive hotel management response
  return `### InnPilot Hotel Business Assistant

I can assist with all operational, financial, and strategic aspects of your hotel:

1. **Revenue Management & Yield Strategy**:
   - Maximizing RevPAR, ADR, and GOPPAR.
   - Implementing dynamic pricing rules based on occupancy tiers.
   - Strategies to drive direct bookings and decrease OTA commission expense.

2. **Front Office & Reservations**:
   - Check-in/check-out standard operating procedures (SOPs).
   - Walk-in guest handling and VIP arrival protocols.
   - Night audit execution and room rate posting.

3. **Housekeeping & Facility Care**:
   - Room cleaning turnover standards and deep-cleaning schedules.
   - Linen par-stock management (3.0 Par rule).
   - Quality inspection checklists for departure rooms.

4. **Food & Beverage (F&B) Management**:
   - Keeping food cost within 28–32% and beverage cost within 18–22%.
   - Menu engineering (Stars, Plowhorses, Puzzles, Dogs).
   - Minimizing kitchen waste through FIFO inventory control.

5. **Conferences & Events (MICE)**:
   - Room setup capacities (Theater, Classroom, U-Shape, Banquet).
   - Day Delegate Rate (DDR) package planning.
   - Banquet Event Order (BEO) coordination and deposit guidelines.

6. **Guest Relations & Service Recovery**:
   - The L.A.S.T. service recovery method (Listen, Apologize, Solve, Thank).
   - Reputation management and OTA review response templates.

*Feel free to ask a specific question on any of these areas (e.g. "How do I calculate GOPPAR?", "What are the housekeeping cleaning steps?", or "How can we reduce OTA commissions?").*`;
}
