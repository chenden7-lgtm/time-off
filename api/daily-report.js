export default async function handler(req, res) {
  // Allow GET requests
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { sync_key, line_webhook } = req.query;

  if (!sync_key) {
    return res.status(400).send('Missing sync_key parameter. Usage: ?sync_key=s_xxx&line_webhook=https://...');
  }

  try {
    // 1. Fetch data from kvdb.io
    const kvdbUrl = `https://kvdb.io/4jVV8b8bbLkHjBX9jQNbAP/${sync_key}`;
    const kvResponse = await fetch(kvdbUrl);
    
    if (!kvResponse.ok) {
      return res.status(404).send('Failed to fetch database from kvdb.io. Please verify your sync_key.');
    }

    const dbData = await kvResponse.json();

    if (!dbData || !dbData.users || !dbData.shifts || !dbData.tasks) {
      return res.status(422).send('Invalid database structure returned from kvdb.io.');
    }

    // 2. Format today's date in Asia/Taipei timezone (UTC+8)
    const now = new Date();
    const tzOffset = 8 * 60; // Taipei timezone offset is +480 minutes
    const localTime = new Date(now.getTime() + tzOffset * 60 * 1000);
    const dateStr = localTime.toISOString().split('T')[0];

    // 3. Filter today's shifts (leaves)
    const leavesToday = dbData.shifts.filter(s => s.date === dateStr && s.type === 'leave');
    const leaveNames = leavesToday.map(s => {
      const userObj = dbData.users.find(u => u.username === s.username);
      return userObj ? userObj.name : s.username;
    });

    // 4. Filter today's cleaning tasks
    const tasksToday = dbData.tasks.filter(t => t.date === dateStr);

    // 5. Format the daily report message
    let msg = `📅 【今日排班與打掃日報 - ${dateStr}】\n\n`;

    msg += `🏖️ 今日排休人員：\n`;
    if (leaveNames.length > 0) {
      leaveNames.forEach(name => {
        msg += `- ${name}\n`;
      });
      msg += `*(其餘人員皆正常上班)*\n\n`;
    } else {
      msg += `(今日無人排休，全體正常上班)\n\n`;
    }

    msg += `🧹 今日打掃安排：\n`;
    if (tasksToday.length > 0) {
      tasksToday.forEach((t, index) => {
        const userObj = dbData.users.find(u => u.username === t.username);
        const name = userObj ? userObj.name : t.username;
        msg += `${index + 1}. ${name} - ${t.area}${t.status === 'completed' ? ' [已完成]' : ''}\n`;
      });
      msg += `\n*請相關負責人於今日完成後登入系統點擊「完成」。*`;
    } else {
      msg += `(今日無指派打掃工作)\n`;
    }

    // 6. If line_webhook is provided, POST the raw text to it (matching the site request)
    if (line_webhook) {
      console.log(`Forwarding daily report to webhook: ${line_webhook}`);
      await fetch(line_webhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8'
        },
        body: msg
      });
    }

    // 7. Return the compiled report as plain text response
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(msg);

  } catch (error) {
    console.error('Error generating daily report:', error);
    return res.status(500).send(`Error generating report: ${error.message}`);
  }
}
