
export type AppState = 'idle' | 'loading' | 'success' | 'error';

export interface AnalysisResult {
  is_ai_generated: boolean;
  confidence_score: number;
  reasoning: string;
  artifacts_detected: string[];
}
