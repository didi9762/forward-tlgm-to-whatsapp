const token = process.env.OPENROUTER_TOKEN || ''
console.log('open router token',token);

export async function askModel(myPrompt:string,model:string='anthropic/claude-3.5-sonnet',temperature:number=0.0,retry=0):Promise<string>{   
  try{
     const response= await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          'model': model,
          'messages': [
            {
              'role': 'user',
              'content': myPrompt
            },
          ],
        'provider': {
          'sort': 'throughput'
        },
        'temperature': temperature
        }),
      })

      const data = await response.json() as any;
      console.log(`ZZZ openrouter (${model}) tokens`,JSON.stringify(data?.usage, null, 2))   
      
      // Check for 401 error (unauthorized) - don't retry
      if(response.status === 401){
        console.log("OpenRouter 401 error - authentication failed, not retrying:", data);
        return '';
      }
      
      if(!data?.choices?.[0]?.message?.content){
        if(retry>3){
          console.log("error in calling openrouter after 3 retries:",data)
          return '';
        }
        console.log("error in calling openrouter try again:",data)
        return askModel(myPrompt,model,temperature,retry+1);
      }
      
      return data?.choices?.[0]?.message?.content;

   }catch(e){
     if(retry>3){
      console.log("error in calling openrouter after 3 retries:",e)
      return '';
    }
    console.log("error in calling openrouter try again:",e);
    return askModel(myPrompt,model,temperature,retry+1);
   }
   }
