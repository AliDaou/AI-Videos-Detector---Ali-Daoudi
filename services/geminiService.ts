
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from '../types';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable is not set.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    is_ai_generated: {
      type: Type.BOOLEAN,
      description: "True if the video is likely AI-generated, false otherwise."
    },
    confidence_score: {
      type: Type.NUMBER,
      description: "A score from 0.0 to 1.0 indicating the confidence in the assessment. 1.0 means 100% confident."
    },
    reasoning: {
      type: Type.STRING,
      description: "A detailed explanation for the conclusion, highlighting specific visual evidence from the frames."
    },
    artifacts_detected: {
      type: Type.ARRAY,
      description: "A list of specific AI-generated artifacts or inconsistencies observed in the frames (e.g., 'unnatural facial expressions', 'background warping', 'six-fingered hand').",
      items: { type: Type.STRING }
    }
  },
  required: ["is_ai_generated", "confidence_score", "reasoning", "artifacts_detected"]
};

export const analyzeVideoFrames = async (frames: string[]): Promise<AnalysisResult> => {
  try {
    const systemInstruction = "You are an expert digital forensics analyst specializing in the detection of AI-generated video content. Your task is to analyze a series of frames from a video and determine if the video is likely synthesized or manipulated by artificial intelligence. Provide your analysis in a structured JSON format.";
    
    const textPart = {
      text: "Analyze the following frames for any artifacts, inconsistencies, or tell-tale signs of AI generation. Consider elements like facial expressions, hand morphology, background consistency, physical interactions (e.g., shadows, reflections), and temporal flickering between frames. Based on your analysis, determine the likelihood that this video was created by an AI."
    };

    const imageParts = frames.map(frameData => ({
      inlineData: {
        mimeType: 'image/jpeg',
        data: frameData
      }
    }));
    
    const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: { parts: [textPart, ...imageParts] },
        config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema,
            temperature: 0.2,
        }
    });

    const jsonText = response.text.trim();
    const result = JSON.parse(jsonText) as AnalysisResult;
    return result;

  } catch (error) {
    console.error("Error calling Gemini API:", error);
    throw new Error("Failed to analyze video frames with Gemini API. The model may have returned an invalid response.");
  }
};
