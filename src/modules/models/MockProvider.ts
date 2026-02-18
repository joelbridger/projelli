// Mock Provider
// Test implementation that returns configurable responses

import type {
  Provider,
  ProviderMetadata,
  ProviderResponse,
  SendOptions,
  StreamOptions,
  OutputSchema,
  StructuredOutputOptions,
} from './Provider';
import { ProviderError } from './Provider';

/**
 * Configuration for mock responses
 */
export interface MockResponse {
  content: string;
  delay?: number;
  error?: {
    message: string;
    type: 'api_error' | 'rate_limit' | 'authentication' | 'validation' | 'timeout' | 'network';
  };
}

/**
 * MockProvider implements Provider for testing without API calls
 */
export class MockProvider implements Provider {
  private responses: Map<string, MockResponse> = new Map();
  private defaultResponse: MockResponse = {
    content: 'This is a mock response.',
    delay: 100,
  };
  private callCount = 0;
  private lastPrompt: string | null = null;

  constructor(
    private readonly model: string = 'mock-model',
    private readonly simulatedCost: number = 0.001,
    private readonly simulatedLatency: number = 100
  ) {}

  getMetadata(): ProviderMetadata {
    return {
      providerId: 'mock',
      model: this.model,
      costEstimate: this.simulatedCost,
      latencyEstimate: this.simulatedLatency,
    };
  }

  isConfigured(): boolean {
    return true; // Mock is always configured
  }

  /**
   * Set a response for a specific prompt pattern
   */
  setResponse(promptPattern: string, response: MockResponse): void {
    this.responses.set(promptPattern, response);
  }

  /**
   * Set the default response for unmatched prompts
   */
  setDefaultResponse(response: MockResponse): void {
    this.defaultResponse = response;
  }

  /**
   * Get the number of calls made
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Get the last prompt sent
   */
  getLastPrompt(): string | null {
    return this.lastPrompt;
  }

  /**
   * Reset call tracking
   */
  reset(): void {
    this.callCount = 0;
    this.lastPrompt = null;
    this.responses.clear();
  }

  /**
   * Track a call (for use by overridden sendMessage implementations)
   */
  trackCall(prompt: string): void {
    this.callCount++;
    this.lastPrompt = prompt;
  }

  async sendMessage(prompt: string, _options?: SendOptions): Promise<ProviderResponse> {
    this.callCount++;
    this.lastPrompt = prompt;

    // Find matching response
    let response = this.defaultResponse;
    for (const [pattern, mockResponse] of this.responses.entries()) {
      if (prompt.includes(pattern)) {
        response = mockResponse;
        break;
      }
    }

    // Simulate delay
    if (response.delay && response.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, response.delay));
    }

    // Simulate error
    if (response.error) {
      throw new ProviderError(
        response.error.message,
        response.error.type,
        500,
        response.error.type === 'rate_limit'
      );
    }

    // Calculate simulated token counts
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(response.content.length / 4);

    return {
      content: response.content,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      cost: (inputTokens + outputTokens) * this.simulatedCost / 1000,
      latency: response.delay ?? this.simulatedLatency,
      model: this.model,
    };
  }

  async sendMessageStreaming(prompt: string, options: StreamOptions): Promise<ProviderResponse> {
    const { onChunk, signal, ...sendOpts } = options;
    const response = await this.sendMessage(prompt, sendOpts);

    // Simulate streaming by emitting content word by word
    const words = response.content.split(' ');
    for (const word of words) {
      if (signal?.aborted) break;
      const chunk = word + ' ';
      onChunk(chunk);
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    return response;
  }

  async toolCall<T>(
    tool: string,
    _params: Record<string, unknown>,
    _options?: SendOptions
  ): Promise<T> {
    this.callCount++;

    // Simulate delay
    await new Promise((resolve) => setTimeout(resolve, this.simulatedLatency));

    // Return mock tool results based on tool name
    const mockResults: Record<string, unknown> = {
      filesystem_read: { content: 'Mock file content' },
      filesystem_write: { success: true },
      search: { results: [] },
    };

    return (mockResults[tool] ?? { result: 'mock' }) as T;
  }

  async structuredOutput<T>(
    prompt: string,
    options: StructuredOutputOptions
  ): Promise<T> {
    this.callCount++;
    this.lastPrompt = prompt;

    // Simulate delay
    await new Promise((resolve) => setTimeout(resolve, this.simulatedLatency));

    // Generate mock structured output based on schema
    const result = this.generateMockFromSchema(options.schema);
    return result as T;
  }

  private generateMockFromSchema(schema: OutputSchema): unknown {
    switch (schema.type) {
      case 'string':
        return 'mock string value';
      case 'number':
        return 42;
      case 'boolean':
        return true;
      case 'array':
        if (schema.items) {
          return [this.generateMockFromSchema(schema.items)];
        }
        return [];
      case 'object':
        if (schema.properties) {
          const obj: Record<string, unknown> = {};
          for (const [key, propSchema] of Object.entries(schema.properties)) {
            obj[key] = this.generateMockFromSchema(propSchema);
          }
          return obj;
        }
        return {};
      default:
        return null;
    }
  }
}

/**
 * Extract a value from a prompt based on a label pattern
 */
function extractFromPrompt(prompt: string, label: string): string {
  // Look for patterns like "**Problem:** Some text here" or "**Problem:** {{problem}}"
  const pattern = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+?)(?=\\n\\n|\\n\\*\\*|$)`, 's');
  const match = prompt.match(pattern);
  if (match && match[1]) {
    const value = match[1].trim();
    // If it's still a template variable, return a placeholder
    if (value.startsWith('{{') && value.endsWith('}}')) {
      return `[${label} not provided]`;
    }
    return value;
  }
  return `[${label} not provided]`;
}

/**
 * Create a MockProvider with preset responses for Business OS workflows
 * This version generates dynamic content based on the actual prompt inputs
 */
export function createMockProvider(): MockProvider {
  const provider = new MockProvider();

  // Override sendMessage to generate dynamic content based on prompt analysis
  const originalSendMessage = provider.sendMessage.bind(provider);

  provider.sendMessage = async function(prompt: string, options?: SendOptions): Promise<ProviderResponse> {
    // Track the call for getLastPrompt() and getCallCount()
    provider.trackCall(prompt);

    const promptLower = prompt.toLowerCase();

    // Check for Vision document generation
    if (promptLower.includes('vision document') || promptLower.includes('generate a comprehensive vision')) {
      const problem = extractFromPrompt(prompt, 'Problem');
      const solution = extractFromPrompt(prompt, 'Solution');
      const targetCustomer = extractFromPrompt(prompt, 'Target Customer');
      const uniqueValue = extractFromPrompt(prompt, 'Unique Value');
      const stage = extractFromPrompt(prompt, 'Stage');

      const content = `# Vision Document

## Executive Summary

This document outlines the vision for a new venture addressing a critical market need. ${problem}

Our solution offers ${solution}

We are targeting ${targetCustomer} and are currently at the ${stage} stage.

## Problem Statement

### The Pain Point
${problem}

### Impact
This problem affects thousands of potential customers daily, leading to wasted time, money, and frustration. Without an effective solution, these customers are forced to rely on inadequate workarounds or expensive alternatives.

### Current Alternatives
- Manual processes that are time-consuming and error-prone
- Expensive enterprise solutions not designed for the target market
- Fragmented tools that don't integrate well

## Solution Overview

### Our Approach
${solution}

### Key Features
1. **Ease of Use** - Designed for users without technical expertise
2. **Affordability** - Priced appropriately for the target market
3. **Integration** - Works seamlessly with existing workflows
4. **Scalability** - Grows with the customer's needs

## Target Market

### Primary Customer Profile
${targetCustomer}

### Market Size
- **TAM (Total Addressable Market)**: Estimated millions of potential users globally
- **SAM (Serviceable Addressable Market)**: Initial focus on early adopters
- **SOM (Serviceable Obtainable Market)**: First-year target of 1,000 paying customers

## Unique Value Proposition

${uniqueValue}

### Why Customers Will Choose Us
1. Purpose-built for the target market
2. Competitive pricing
3. Superior user experience
4. Strong customer support

## Vision Statement

In 5 years, we will be the leading solution in our category, serving tens of thousands of satisfied customers worldwide. We will have expanded our product offering while maintaining our core commitment to simplicity and user empowerment.

## Success Metrics

### Year 1 Goals
- Launch MVP and acquire first 100 customers
- Achieve 40% month-over-month growth
- Maintain NPS score above 50

### Key Performance Indicators
- Monthly Active Users (MAU)
- Customer Acquisition Cost (CAC)
- Lifetime Value (LTV)
- Net Promoter Score (NPS)
- Monthly Recurring Revenue (MRR)

## Key Assumptions

1. The target market is willing to pay for this solution
2. We can acquire customers at a sustainable cost
3. The problem is significant enough to drive adoption
4. We can build the solution with available resources
5. Competition will not immediately replicate our approach

## Next Steps

1. Validate assumptions through customer interviews
2. Build and launch MVP
3. Gather feedback and iterate
4. Scale customer acquisition
`;

      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 500));

      return {
        content,
        usage: {
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: Math.ceil(content.length / 4),
          totalTokens: Math.ceil(prompt.length / 4) + Math.ceil(content.length / 4),
        },
        cost: 0.002,
        latency: 500,
        model: 'mock-model',
      };
    }

    // Check for PRD generation
    if (promptLower.includes('product requirements document') || promptLower.includes('prd')) {
      const problem = extractFromPrompt(prompt, 'Problem');
      const solution = extractFromPrompt(prompt, 'Solution');
      const targetCustomer = extractFromPrompt(prompt, 'Target Customer');
      const revenueModel = extractFromPrompt(prompt, 'Revenue Model');

      const content = `# Product Requirements Document (PRD)

## Overview

### What We're Building
${solution}

### Why We're Building It
${problem}

### Target Users
${targetCustomer}

## Goals and Non-Goals

### Goals (MVP)
- Solve the core problem for early adopters
- Provide a simple, intuitive user experience
- Establish foundation for future features
- Validate key product assumptions

### Non-Goals (For This Version)
- Advanced enterprise features
- Multi-language support
- Native mobile applications
- Third-party integrations (beyond essential ones)

## User Stories

### Core User Journey
1. As a user, I want to sign up quickly so that I can start using the product immediately
2. As a user, I want to understand the value proposition so that I know this solves my problem
3. As a user, I want to complete the main workflow so that I can achieve my goal
4. As a user, I want to see my progress so that I feel accomplished
5. As a user, I want to get help when stuck so that I don't abandon the product

### Feature-Specific Stories
6. As a user, I want to save my work so that I don't lose progress
7. As a user, I want to export my data so that I can use it elsewhere
8. As a user, I want to customize settings so that the product fits my workflow
9. As a user, I want to receive notifications so that I stay informed
10. As a user, I want to share results so that I can collaborate with others

## Functional Requirements

### Authentication & Onboarding
- [ ] User registration with email
- [ ] Secure login/logout
- [ ] Password reset flow
- [ ] Onboarding tutorial

### Core Features
- [ ] Main dashboard view
- [ ] Primary workflow completion
- [ ] Data input and validation
- [ ] Results display
- [ ] Save/load functionality

### Secondary Features
- [ ] Settings and preferences
- [ ] Basic reporting
- [ ] Export functionality
- [ ] Help and documentation

## Non-Functional Requirements

### Performance
- Page load time < 3 seconds
- API response time < 500ms
- Support 1,000 concurrent users

### Security
- HTTPS everywhere
- Data encryption at rest
- Regular security audits
- GDPR compliance

### Reliability
- 99.9% uptime SLA
- Daily backups
- Disaster recovery plan

### Accessibility
- WCAG 2.1 AA compliance
- Keyboard navigation
- Screen reader support

## Success Criteria

### Launch Criteria
- All P0 bugs resolved
- Core user journey tested
- Documentation complete
- Support system ready

### Success Metrics
- 100 sign-ups in first month
- 30% activation rate
- 20% weekly retention
- NPS > 30

## Open Questions

1. What authentication provider should we use?
2. Should we offer a free trial or freemium model?
3. What analytics events should we track?
4. How do we handle data migration from competitors?

## Future Considerations

### Phase 2 Features
- Advanced analytics
- Team collaboration
- API access
- Mobile apps

### Pricing Evolution
${revenueModel}

### Technical Debt
- Performance optimization
- Code refactoring
- Test coverage improvement
`;

      await new Promise(resolve => setTimeout(resolve, 600));

      return {
        content,
        usage: {
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: Math.ceil(content.length / 4),
          totalTokens: Math.ceil(prompt.length / 4) + Math.ceil(content.length / 4),
        },
        cost: 0.003,
        latency: 600,
        model: 'mock-model',
      };
    }

    // Check for Lean Canvas generation
    if (promptLower.includes('lean canvas')) {
      const problem = extractFromPrompt(prompt, 'Problem');
      const solution = extractFromPrompt(prompt, 'Solution');
      const targetCustomer = extractFromPrompt(prompt, 'Target Customer');
      const uniqueValue = extractFromPrompt(prompt, 'Unique Value');
      const channels = extractFromPrompt(prompt, 'Channels');
      const revenueModel = extractFromPrompt(prompt, 'Revenue Model');
      const competitors = extractFromPrompt(prompt, 'Competitors');

      const content = `# Lean Canvas

| Section | Content |
|---------|---------|
| **Problem** | ${problem} |
| **Customer Segments** | ${targetCustomer} |
| **Unique Value Proposition** | ${uniqueValue} |
| **Solution** | ${solution} |
| **Channels** | ${channels} |
| **Revenue Streams** | ${revenueModel} |
| **Cost Structure** | Development costs, hosting/infrastructure, marketing, customer support, operational overhead |
| **Key Metrics** | Monthly Active Users, Customer Acquisition Cost, Lifetime Value, Churn Rate, Net Promoter Score |
| **Unfair Advantage** | ${uniqueValue} - This creates a sustainable competitive moat that is difficult for competitors to replicate. |

## Business Model Narrative

### The Opportunity

We've identified a significant market opportunity: ${problem}

Our target customers are ${targetCustomer}. These users are currently underserved by existing solutions, which are either too expensive, too complex, or simply not designed with their needs in mind.

### Our Approach

We're building ${solution}

What sets us apart is ${uniqueValue}. This isn't just a feature - it's a fundamental differentiator that our competitors (${competitors}) cannot easily replicate.

### Path to Revenue

Our monetization strategy is straightforward: ${revenueModel}

We'll reach customers through ${channels}, focusing initially on the channels with the highest ROI before expanding our reach.

### Key Risks and Mitigations

1. **Market Risk**: The market may be smaller than anticipated. We'll validate with customer interviews and early pilots.
2. **Execution Risk**: We may not be able to deliver the product as envisioned. We'll use agile development with frequent user feedback.
3. **Competition Risk**: Competitors may copy our approach. We'll focus on building strong customer relationships and continuous innovation.

### Next Steps

1. Validate problem-solution fit with 20 customer interviews
2. Build MVP with core functionality
3. Launch to early adopters and gather feedback
4. Iterate based on usage data and user feedback
5. Scale customer acquisition through proven channels
`;

      await new Promise(resolve => setTimeout(resolve, 450));

      return {
        content,
        usage: {
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: Math.ceil(content.length / 4),
          totalTokens: Math.ceil(prompt.length / 4) + Math.ceil(content.length / 4),
        },
        cost: 0.0025,
        latency: 450,
        model: 'mock-model',
      };
    }

    // Fall back to original behavior for unrecognized prompts
    return originalSendMessage(prompt, options);
  };

  return provider;
}
