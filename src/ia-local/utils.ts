export function calculateSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  
  const words1 = new Set(
    text1.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2) // Ignorar palabras muy cortas
  );
  
  const words2 = new Set(
    text2.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2)
  );
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

export function getKeywordScore(msg: string, keywords: string[]): number {
  let score = 0;
  const msgLower = msg.toLowerCase();
  
  keywords.forEach(keyword => {
    const keywordLower = keyword.toLowerCase();
    
    // Puntuación alta para coincidencia exacta
    if (msgLower === keywordLower) {
      score += 5;
    }
    // Puntuación media para palabra completa
    else if (new RegExp(`\\b${keywordLower}\\b`).test(msgLower)) {
      score += 3;
    }
    // Puntuación baja para subcadena
    else if (msgLower.includes(keywordLower)) {
      score += 1;
    }
  });
  
  return score;
}
