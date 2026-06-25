export const formatDate = (dateString: string) => {
  const d = new Date(dateString);
  return d.toLocaleDateString('zh-CN', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
};
