window.__ModuleLoader__.load({
  id: 'dsh-collab',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-collab/api'
    const POLL_MS = 2000

    const TEXT = {
      idleTitle: '协作室 · 未开启',
      idleHint: '开启后把邀请链接或二维码给朋友，每个人的研究进度会实时汇总到这里。',
      open: '开启协作',
      close: '收起',
      name: '你的显示名',
      create: '创建协作室',
      lab: '本机实验（起 2 个模拟成员）',
      labOn: '本机实验运行中',
      labStop: '停止实验',
      joinTitle: '加入别人的协作室',
      joinHint: '把邀请链接 / 二维码文本粘到下面，或手工填 relay 与邀请码。',
      paste: '粘贴邀请链接或二维码文本',
      relay: 'Relay 地址',
      code: '邀请码',
      join: '加入',
      leave: '离开',
      copy: '复制邀请',
      copyLink: '复制链接',
      copied: '已复制',
      invite: '邀请码',
      relayLabel: 'Relay',
      members: '成员',
      messages: '协作消息',
      send: '发送',
      placeholder: '说点什么给房间里的人…',
      emptyMembers: '还没有其他成员。',
      emptyMessages: '还没有消息。',
      running: '研究中',
      idle: '空闲',
      tokens: 'token',
      noSession: '暂无进行的会话',
      scanHint: '手机扫码，或把链接发给朋友（他在自己的 DSH 里打开会自动带出邀请码）。',
      loopbackWarning:
        '这台机器没有局域网 IPv4，邀请地址是 127.0.0.1：只有同一台电脑上的 DSH 能加入。要跨机器请让 DSH 监听局域网地址后重进本面板。',
      lanHint: '朋友要在他自己的 DSH 里加入时，relay 地址用上面这个（你的局域网地址）。',
      fromLink: '已从邀请链接带出信息，确认名字后点「加入」。',
      tunnelOn: '开启公网 invitation（跨网段）',
      tunnelOnLabel: '公网邀请',
      tunnelStop: '关闭公网隧道',
      tunnelIdle: '未开公网隧道：只能同网段或本机加入',
      tunnelStarting: '隧道启动中（cloudflared 正在向 Cloudflare 取地址）…',
      tunnelError: '隧道启动失败：',
      tunnelHint: '公网隧道已开启：朋友在任何网络、任何机器上都能用这个链接加入（隧道随 DSH 关闭失效）。',
      projectLabel: '项目',
      roomTotal: '房间合计',
    }

    function fmtTokens(n) {
      const v = Number(n) || 0
      if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
      if (v >= 1000) return (v / 1000).toFixed(1) + 'k'
      return String(v)
    }

    function timeAgo(at) {
      const diff = Date.now() - (Number(at) || 0)
      if (!Number.isFinite(diff) || diff < 0) return ''
      if (diff < 60_000) return '刚刚'
      if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前'
      return Math.floor(diff / 3_600_000) + ' 小时前'
    }

    /** 从邀请链接 / 二维码文本里提取 relay 与邀请码。 */
    function parseInvite(text) {
      const raw = String(text || '').trim()
      if (!raw) return null
      try {
        const url = new URL(raw)
        const code = url.searchParams.get('collab') || url.searchParams.get('code') || url.searchParams.get('c')
        const relay = url.searchParams.get('relay') || url.searchParams.get('r')
        if (code) return { code: String(code).toUpperCase(), relay: relay ? String(relay) : undefined }
      } catch {
        /* 不是 URL，继续按文本解析 */
      }
      const relayMatch = /relay\s*[:=]\s*(\S+)/i.exec(raw)
      const codeMatch = /code\s*[:=]\s*([A-Z0-9]{4,12})/i.exec(raw)
      if (codeMatch) return { code: codeMatch[1].toUpperCase(), relay: relayMatch ? relayMatch[1] : undefined }
      if (/^[A-Z0-9]{4,12}$/i.test(raw)) return { code: raw.toUpperCase() }
      return null
    }

    /** 当前页 URL 里带的邀请参数（朋友点链接打开 DSH 时自动预填）。 */
    function inviteFromLocation() {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('collab') || params.get('code')
        if (!code) return null
        return { code: String(code).toUpperCase(), relay: params.get('relay') || undefined }
      } catch {
        return null
      }
    }

    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0 4px' },
      bar: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #9aa0a6)' },
      dot: { width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto' },
      linkBtn: {
        marginLeft: 'auto',
        background: 'transparent',
        border: 'none',
        padding: '2px 4px',
        cursor: 'pointer',
        fontSize: 12,
        color: 'var(--dsw-alias-brand-primary, #4c8dff)',
        fontFamily: 'inherit',
      },
      card: {
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))',
        background: 'var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06))',
        borderRadius: 10,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      label: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #8b9096)' },
      input: {
        flex: '1 1 140px',
        minWidth: 120,
        padding: '6px 9px',
        fontSize: 12,
        color: 'var(--dsw-alias-label-primary, #e8eaed)',
        background: 'var(--dsw-alias-bg-base, rgba(0,0,0,.16))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))',
        borderRadius: 7,
        fontFamily: 'inherit',
        outline: 'none',
      },
      btn: {
        padding: '6px 12px',
        fontSize: 12,
        borderRadius: 7,
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4))',
        background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12))',
        color: 'var(--dsw-alias-label-primary, #e8eaed)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      btnPrimary: {
        padding: '6px 12px',
        fontSize: 12,
        borderRadius: 7,
        border: '1px solid transparent',
        background: 'var(--dsw-alias-brand-primary, #4c8dff)',
        color: '#fff',
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      code: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 22,
        letterSpacing: 5,
        color: 'var(--dsw-alias-brand-primary, #4c8dff)',
      },
      member: {
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.24))',
        borderRadius: 8,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.06))',
      },
      session: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary, #9aa0a6)',
        minWidth: 0,
      },
      ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      messages: { maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, padding: '2px' },
      msg: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary, #e8eaed)', wordBreak: 'break-word' },
      msgMeta: { fontSize: 10, color: 'var(--dsw-alias-label-tertiary, #8b9096)', marginRight: 6 },
      error: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary, #e5534b)' },
      badge: {
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3))',
        color: 'var(--dsw-alias-label-tertiary, #8b9096)',
      },
      warn: { fontSize: 11, color: 'var(--dsw-alias-state-warn-primary, #d29922)' },
      qrBox: { background: '#fff', padding: 8, borderRadius: 10, lineHeight: 0, flex: '0 0 auto' },
      linkBox: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        padding: '6px 8px',
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-base, rgba(0,0,0,.2))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28))',
        wordBreak: 'break-all',
        color: 'var(--dsw-alias-label-secondary, #9aa0a6)',
      },
    }

    function QrCode({ qr, size }) {
      if (!qr || !qr.path) return null
      const dim = qr.dimension
      return h(
        'div',
        { style: S.qrBox },
        h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: `0 0 ${dim} ${dim}`,
            shapeRendering: 'crispEdges',
            role: 'img',
            'aria-label': '协作室邀请二维码',
          },
          h('rect', { width: dim, height: dim, fill: '#fff' }),
          h('path', { d: qr.path, fill: '#000' }),
        ),
      )
    }

    function CollabPanel() {
      const [snap, setSnap] = React.useState(null)
      const [expanded, setExpanded] = React.useState(false)
      const [name, setName] = React.useState('')
      const [relay, setRelay] = React.useState('')
      const [code, setCode] = React.useState('')
      const [paste, setPaste] = React.useState('')
      const [draft, setDraft] = React.useState('')
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [copied, setCopied] = React.useState('')
      const mounted = React.useRef(true)
      const prefilled = React.useRef(false)

      React.useEffect(() => {
        mounted.current = true
        let timer = null
        const load = async () => {
          try {
            const res = await fetch(API + '/state', { headers: { accept: 'application/json' } })
            if (!res.ok) throw new Error('state ' + res.status)
            const data = await res.json()
            if (!mounted.current) return
            setSnap(data)
            setError('')
            if (data && data.self && data.self.name && !name) setName(data.self.name)
            if (!prefilled.current) {
              const fromUrl = inviteFromLocation()
              if (fromUrl && data && data.mode === 'offline') {
                prefilled.current = true
                setCode(fromUrl.code)
                if (fromUrl.relay) setRelay(fromUrl.relay)
                setExpanded(true)
                setNotice(TEXT.fromLink)
              }
            }
          } catch (e) {
            if (mounted.current) setError('协作服务不可达：' + (e && e.message ? e.message : e))
          }
          if (mounted.current) timer = setTimeout(load, POLL_MS)
        }
        void load()
        return () => {
          mounted.current = false
          if (timer) clearTimeout(timer)
        }
      }, [])

      const call = async (path, body) => {
        setBusy(true)
        try {
          const res = await fetch(API + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body || {}),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            setError(data && data.error ? data.error : '请求失败(' + res.status + ')')
            return null
          }
          setError('')
          const state = await fetch(API + '/state')
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
          if (state) setSnap(state)
          return data
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
          return null
        } finally {
          setBusy(false)
        }
      }

      const copy = async (text, tag) => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(tag)
          setTimeout(() => mounted.current && setCopied(''), 1500)
        } catch {
          setError('复制失败，请手工选中复制')
        }
      }

      const mode = (snap && snap.mode) || 'offline'
      const active = mode === 'host' || mode === 'guest'
      const invite = snap && snap.invite
      const members = (snap && snap.members) || []
      const messages = (snap && snap.messages) || []
      const lab = (snap && snap.lab) || { running: false, members: [] }
      const tunnelInfo = (snap && snap.tunnel) || null
      const runningCount = members.reduce(
        (sum, m) => sum + ((m.sessions || []).filter((s) => s.status === 'running').length || 0),
        0,
      )
      const roomTokens = members.reduce(
        (sum, m) => sum + (m.sessions || []).reduce((x, s) => x + (s.tokensIn || 0) + (s.tokensOut || 0), 0),
        0,
      )

      const barColor = active
        ? runningCount > 0
          ? 'var(--dsw-alias-state-success-primary, #3fb950)'
          : 'var(--dsw-alias-brand-primary, #4c8dff)'
        : 'var(--dsw-alias-state-idle-primary, #8b9096)'
      const barText = !active
        ? TEXT.idleTitle
        : '协作室 ' +
          ((snap && snap.code) || '') +
          ' · ' +
          members.length +
          ' 人 · ' +
          runningCount +
          ' 个会话在跑 · ' +
          messages.length +
          ' 条消息'

      const doPaste = () => {
        const parsed = parseInvite(paste)
        if (!parsed) {
          setError('没从这段文本里认出邀请码')
          return
        }
        setError('')
        setCode(parsed.code)
        if (parsed.relay) setRelay(parsed.relay)
        setNotice('已从粘贴内容带出 relay 与邀请码')
        setPaste('')
      }

      const doJoin = async () => {
        const parsedCode = (code || '').trim().toUpperCase() || (parseInvite(paste) || {}).code
        const parsedRelay = (relay || '').trim() || (parseInvite(paste) || {}).relay
        const finalRelay = parsedRelay || window.location.origin + '/dsh-collab/relay'
        if (!parsedCode) {
          setError('还需要邀请码')
          return
        }
        const ok = await call('/join', { relay: finalRelay, code: parsedCode, name })
        if (ok) {
          setNotice('')
          setExpanded(true)
        }
      }

      return h(
        'div',
        { style: S.wrap, 'data-dsh-collab': 'panel' },
        h(
          'div',
          { style: S.bar },
          h('span', { style: { ...S.dot, background: barColor } }),
          h('span', { style: S.ellipsis }, barText),
          h('button', { type: 'button', style: S.linkBtn, onClick: () => setExpanded((v) => !v) }, expanded ? TEXT.close : TEXT.open),
        ),
        expanded
          ? h(
              'div',
              { style: S.card },
              !active
                ? h(
                    React.Fragment,
                    null,
                    h('div', { style: S.label }, TEXT.idleHint),
                    h(
                      'div',
                      { style: S.row },
                      h('input', {
                        style: S.input,
                        placeholder: TEXT.name,
                        value: name,
                        onChange: (e) => setName(e.target.value),
                      }),
                      h('button', { type: 'button', style: S.btnPrimary, disabled: busy, onClick: () => call('/create', { name }) }, TEXT.create),
                      h('button', { type: 'button', style: S.btn, disabled: busy, onClick: () => call('/lab', { members: 2 }) }, TEXT.lab),
                    ),
                    h('div', { style: { ...S.label, marginTop: 4 } }, TEXT.joinTitle),
                    h('div', { style: S.label }, TEXT.joinHint),
                    h(
                      'div',
                      { style: S.row },
                      h('input', {
                        style: S.input,
                        placeholder: TEXT.paste,
                        value: paste,
                        onChange: (e) => setPaste(e.target.value),
                        onKeyDown: (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            doPaste()
                          }
                        },
                      }),
                      h('button', { type: 'button', style: S.btn, disabled: !paste.trim(), onClick: doPaste }, '识别'),
                    ),
                    h(
                      'div',
                      { style: S.row },
                      h('input', {
                        style: S.input,
                        placeholder: TEXT.relay,
                        value: relay,
                        onChange: (e) => setRelay(e.target.value),
                      }),
                      h('input', {
                        style: { ...S.input, flex: '0 0 104px' },
                        placeholder: TEXT.code,
                        value: code,
                        onChange: (e) => setCode(e.target.value.toUpperCase()),
                      }),
                      h('button', { type: 'button', style: S.btn, disabled: busy, onClick: doJoin }, TEXT.join),
                    ),
                    notice ? h('div', { style: S.label }, notice) : null,
                  )
                : h(
                    React.Fragment,
                    null,
                    h(
                      'div',
                      { style: { ...S.row, justifyContent: 'space-between' } },
                      h(
                        'div',
                        { style: { ...S.row, gap: 10, alignItems: 'baseline' } },
                        h('span', { style: S.label }, TEXT.invite),
                        h('span', { style: S.code }, (snap && snap.code) || '------'),
                        h('span', { style: S.badge }, mode === 'host' ? '房主' : '成员'),
                      ),
                      h(
                        'div',
                        { style: S.row },
                        mode === 'host'
                          ? h(
                              'div',
                              { style: { ...S.row, gap: 8 } },
                              h('span', { style: { ...S.label, color: 'var(--dsw-alias-label-secondary, #9aa0a6)' } },
                                TEXT.projectLabel + '：' + ((snap && snap.project && snap.project.name) || '未命名')),
                              (snap && snap.project && snap.project.cwd)
                                ? h('span', { style: { ...S.label, ...S.ellipsis, maxWidth: 260 } }, snap.project.cwd)
                                : null,
                            )
                          : null,
                        mode === 'host'
                          ? h(
                              'div',
                              { style: { ...S.row, gap: 8 } },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  style: tunnelInfo && tunnelInfo.running ? S.btn : S.btnPrimary,
                                  disabled: busy || (tunnelInfo && tunnelInfo.starting),
                                  onClick: () => call(tunnelInfo && tunnelInfo.running ? '/tunnel/stop' : '/tunnel/start'),
                                },
                                tunnelInfo && tunnelInfo.running ? TEXT.tunnelStop : TEXT.tunnelOnLabel,
                              ),
                              tunnelInfo && tunnelInfo.starting
                                ? h('span', { style: S.label }, TEXT.tunnelStarting)
                                : tunnelInfo && tunnelInfo.running
                                  ? h('span', { style: { ...S.label, wordBreak: 'break-all' } }, tunnelInfo.url)
                                  : h('span', { style: S.label }, tunnelInfo && tunnelInfo.error ? TEXT.tunnelError + tunnelInfo.error : TEXT.tunnelIdle),
                            )
                          : null,
                        mode === 'host' && invite
                          ? h('button', { type: 'button', style: S.btn, onClick: () => copy(invite.primaryUrl, 'invite') }, copied === 'invite' ? TEXT.copied : TEXT.copy)
                          : null,
                        h('button', { type: 'button', style: S.btn, disabled: busy, onClick: () => call('/leave') }, TEXT.leave),
                      ),
                    ),
                    mode === 'host' && invite
                      ? h(
                          'div',
                          { style: { display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' } },
                          h(QrCode, { qr: invite.qr, size: 128 }),
                          h(
                            'div',
                            { style: { flex: '1 1 200px', minWidth: 180, display: 'flex', flexDirection: 'column', gap: 6 } },
                            h('div', { style: S.label }, TEXT.scanHint),
                            h('div', { style: S.linkBox }, invite.primaryUrl),
                            h(
                              'div',
                              { style: S.row },
                              h('button', { type: 'button', style: S.btn, onClick: () => copy(invite.primaryUrl, 'link') }, copied === 'link' ? TEXT.copied : TEXT.copyLink),
                              h('button', { type: 'button', style: S.btn, onClick: () => copy(invite.plain, 'plain') }, copied === 'plain' ? TEXT.copied : '复制 relay+码'),
                            ),
                            h('div', { style: S.label, wordBreak: 'break-all' }, TEXT.relayLabel + '：' + invite.lanRelay),
                            h(
                              'div',
                              { style: S.warn },
                              invite.channel === 'tunnel' ? TEXT.tunnelHint : invite.reachable ? TEXT.lanHint : TEXT.loopbackWarning,
                            ),
                          ),
                        )
                      : h('div', { style: { ...S.label, wordBreak: 'break-all' } }, TEXT.relayLabel + '：' + ((snap && snap.relay) || relay)),
                    mode === 'host'
                      ? h(
                          'div',
                          { style: S.row },
                          h(
                            'button',
                            {
                              type: 'button',
                              style: S.btn,
                              disabled: busy,
                              onClick: () => call(lab.running ? '/lab/stop' : '/lab', lab.running ? {} : { members: 2 }),
                            },
                            lab.running ? TEXT.labStop : TEXT.lab,
                          ),
                          lab.running ? h('span', { style: S.label }, TEXT.labOn + '：' + (lab.members || []).join(' / ')) : null,
                          h('span', { style: { ...S.label, marginLeft: 'auto' } }, TEXT.roomTotal + ' ' + fmtTokens(roomTokens) + ' ' + TEXT.tokens),
                        )
                      : null,
                    h(
                      'div',
                      null,
                      h('div', { style: { ...S.label, marginBottom: 6 } }, TEXT.members + ' (' + members.length + ')'),
                      h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                        members.length === 0
                          ? h('div', { style: S.label }, TEXT.emptyMembers)
                          : members.map((m) =>
                              h(
                                'div',
                                { key: m.id, style: S.member },
                                h(
                                  'div',
                                  { style: { ...S.row, gap: 6 } },
                                  h('span', {
                                    style: {
                                      ...S.dot,
                                      background: m.online
                                        ? 'var(--dsw-alias-state-success-primary, #3fb950)'
                                        : 'var(--dsw-alias-state-idle-primary, #8b9096)',
                                    },
                                  }),
                                  h(
                                    'span',
                                    { style: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #e8eaed)' } },
                                    m.name || m.id,
                                  ),
                                  m.self ? h('span', { style: S.badge }, '我') : null,
                                  h('span', { style: { ...S.label, marginLeft: 'auto' } }, timeAgo(m.updatedAt)),
                                ),
                                (m.sessions || []).length === 0
                                  ? h('div', { style: S.label }, TEXT.noSession)
                                  : (m.sessions || []).slice(0, 6).map((s) =>
                                      h(
                                        'div',
                                        { key: s.id, style: S.session },
                                        h('span', {
                                          style: {
                                            ...S.dot,
                                            width: 5,
                                            height: 5,
                                            background:
                                              s.status === 'running'
                                                ? 'var(--dsw-alias-state-success-primary, #3fb950)'
                                                : 'var(--dsw-alias-state-idle-primary, #8b9096)',
                                          },
                                        }),
                                        h('span', { style: { ...S.ellipsis, maxWidth: 120 } }, s.label || s.id),
                                        h(
                                          'span',
                                          { style: { ...S.ellipsis, flex: 1, minWidth: 0 } },
                                          (s.status === 'running' ? TEXT.running : TEXT.idle) +
                                            (s.tool ? ' · ' + s.tool : '') +
                                            (s.note ? ' · ' + s.note : ''),
                                        ),
                                        h('span', { style: { flex: '0 0 auto' } }, fmtTokens((s.tokensIn || 0) + (s.tokensOut || 0)) + ' ' + TEXT.tokens),
                                      ),
                                    ),
                              ),
                            ),
                      ),
                    ),
                    h(
                      'div',
                      null,
                      h('div', { style: { ...S.label, marginBottom: 6 } }, TEXT.messages),
                      h(
                        'div',
                        { style: S.messages },
                        messages.length === 0
                          ? h('div', { style: S.label }, TEXT.emptyMessages)
                          : messages.map((m) =>
                              h(
                                'div',
                                { key: m.id, style: S.msg },
                                h('span', { style: S.msgMeta }, (m.name || '?') + ' · ' + timeAgo(m.at)),
                                m.text,
                              ),
                            ),
                      ),
                      h(
                        'div',
                        { style: { ...S.row, marginTop: 8 } },
                        h('input', {
                          style: S.input,
                          placeholder: TEXT.placeholder,
                          value: draft,
                          onChange: (e) => setDraft(e.target.value),
                          onKeyDown: (e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              if (draft.trim()) void call('/message', { text: draft }).then((ok) => ok && setDraft(''))
                            }
                          },
                        }),
                        h(
                          'button',
                          {
                            type: 'button',
                            style: S.btnPrimary,
                            disabled: busy || !draft.trim(),
                            onClick: async () => {
                              const ok = await call('/message', { text: draft })
                              if (ok) setDraft('')
                            },
                          },
                          TEXT.send,
                        ),
                      ),
                    ),
                  ),
              error ? h('div', { style: S.error }, error) : null,
            )
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const dispose = ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({ name: 'conversation.composer.dock', id: 'dsh-collab', order: 20 }, CollabPanel),
        )
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      },
    }
  },
})
