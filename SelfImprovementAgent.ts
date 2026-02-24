type Feedback = "too_short" | "too_long" | "perfect";

class SelfImprovingAgent {
  // The agent's internal "logic" that it will modify
  private currentStrategy: string = "Give a brief hello.";
  private version: number = 1;

  constructor() {}

  // 1. EXECUTION: Act based on current strategy
  public greet(name: string): string {
    console.log(`\n--- Agent v${this.version} ---`);
    if (this.currentStrategy.includes("brief")) {
      return `Hi ${name}.`;
    } else if (this.currentStrategy.includes("enthusiastic")) {
      return `HELLOOO ${name}! Hope you have a fantastic day!`;
    } else {
      return `Greetings, ${name}. How may I assist you today?`;
    }
  }

  // 2. EVALUATION & 3. SYNTHESIS: Analyze feedback and "rewrite" strategy
  public selfImprove(feedback: Feedback): void {
    console.log(`Processing feedback: ${feedback}...`);
    
    if (feedback === "too_short") {
      this.currentStrategy = "Be more enthusiastic and long-winded.";
    } else if (feedback === "too_long") {
      this.currentStrategy = "Be professional and concise.";
    }

    this.version++;
    console.log(`Update complete. New strategy: "${this.currentStrategy}"`);
  }
}

// --- Usage ---
const agent = new SelfImprovingAgent();

// Round 1
console.log(agent.greet("Alice")); 
// Feedback: "That was a bit dry..." -> too_short
agent.selfImprove("too_short");

// Round 2 (The agent has now "evolved")
console.log(agent.greet("Alice"));
