export const policies=['unique-positive','first-positive'];
export function shouldPromote(candidates,policy){
 if(!policies.includes(policy))throw new Error('Unknown promotion policy: '+policy);
 return policy==='first-positive'?candidates.length>0:candidates.length===1;
}
export function stopValidation(verdict,policy){
 if(!policies.includes(policy))throw new Error('Unknown promotion policy: '+policy);
 return policy==='first-positive'&&verdict==='accept';
}
